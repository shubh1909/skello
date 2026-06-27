-- =============================================================================
-- 20260623000001 — Soft delete for campaign data ("delete from our sight,
-- keep in the DB").
-- =============================================================================
-- An org can permanently remove a finished campaign's data from THEIR view —
-- the campaign, its contacts, every dial + transcript, any callbacks it spawned,
-- and the leads it solely created — while every row stays intact in the DB for
-- contractual/handover reasons. Restore is service-role only (no org UI).
--
-- Design (see the planning thread):
--   * Soft delete = stamping (deleted_at, deleted_by, deletion_batch_id) on a
--     row. One batch id per delete click, so a restore replays exactly what was
--     hidden — important because lead hiding is CONDITIONAL.
--   * Visibility is enforced in the RLS SELECT policies (deleted_at is null), so
--     every org-facing read through the user client is covered in one place.
--     Service-role paths (dispatcher, webhooks, analytics) bypass RLS and still
--     see everything — intended: data is kept, and analytics keeps counting.
--   * "Sole-owned lead": a lead is hidden only if EVERY call on it belongs to
--     this campaign. A lead shared with inbound / manual / another campaign
--     stays visible; only this campaign's calls on it are hidden. We never hide
--     data the org built elsewhere.
--   * Dedup index becomes partial (deleted_at is null) so a future call to a
--     handed-over number creates a FRESH visible lead instead of resurfacing the
--     hidden one. NOTE: the lead find-or-create code path must also filter
--     deleted_at is null (companion app change) or it would match a hidden row.
--
-- Append-only: existing rows have NULL deleted_at = visible; zero backfill.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Soft-delete columns on every table a campaign delete touches.
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'campaigns',
    'campaign_contacts',
    'calls',
    'call_transcripts',
    'leads',
    'scheduled_callbacks',
    'reminders'
  ]
  loop
    execute format('alter table public.%I add column if not exists deleted_at timestamptz', t);
    execute format('alter table public.%I add column if not exists deleted_by uuid references auth.users (id) on delete set null', t);
    execute format('alter table public.%I add column if not exists deletion_batch_id uuid', t);
    -- Fast restore + "what is currently hidden" lookups by batch.
    execute format(
      'create index if not exists %I on public.%I (deletion_batch_id) where deletion_batch_id is not null',
      t || '_deletion_batch_idx', t
    );
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Lead dedup becomes partial so a hidden lead frees its phone slot.
--    A new interaction to the same number creates a fresh visible lead instead
--    of merging into the handed-over (hidden) one.
-- -----------------------------------------------------------------------------

drop index if exists public.leads_org_phone_norm_unique_idx;
create unique index if not exists leads_org_phone_norm_unique_idx
  on public.leads (organisation_id, phone_normalized)
  where phone_normalized is not null and deleted_at is null;

-- -----------------------------------------------------------------------------
-- 3. RLS SELECT policies hide soft-deleted rows from the user (org) client.
--    Service-role bypasses RLS, so internal/analytics reads are unaffected.
--    Only the SELECT policies change; insert/update/delete policies are
--    untouched (mutations of hidden rows are gated server-side anyway).
-- -----------------------------------------------------------------------------

-- leads — org scope is org_slug (not organisation_id) on this table.
drop policy if exists "leads_select_own_org" on public.leads;
create policy "leads_select_own_org"
  on public.leads for select
  to authenticated
  using (
    deleted_at is null
    and org_slug in (
      select slug from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "calls_select_own_org" on public.calls;
create policy "calls_select_own_org"
  on public.calls for select
  to authenticated
  using (
    deleted_at is null
    and organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "call_transcripts_select_own_org" on public.call_transcripts;
create policy "call_transcripts_select_own_org"
  on public.call_transcripts for select
  to authenticated
  using (
    deleted_at is null
    and organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "campaigns_select_own_org" on public.campaigns;
create policy "campaigns_select_own_org"
  on public.campaigns for select
  to authenticated
  using (
    deleted_at is null
    and organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "campaign_contacts_select_own_org" on public.campaign_contacts;
create policy "campaign_contacts_select_own_org"
  on public.campaign_contacts for select
  to authenticated
  using (
    deleted_at is null
    and organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "scheduled_callbacks_select_own_org" on public.scheduled_callbacks;
create policy "scheduled_callbacks_select_own_org"
  on public.scheduled_callbacks for select
  to authenticated
  using (
    deleted_at is null
    and organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "reminders_select_own_org" on public.reminders;
create policy "reminders_select_own_org"
  on public.reminders for select
  to authenticated
  using (
    deleted_at is null
    and organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

-- -----------------------------------------------------------------------------
-- 4. soft_delete_campaign(campaign_id, user_id) — atomic, service-role only.
--    Called by the server action AFTER it verifies the caller owns the org and
--    the campaign is no longer running. Returns the batch id + per-table counts.
-- -----------------------------------------------------------------------------

create or replace function public.soft_delete_campaign(
  p_campaign_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_org uuid;
  v_already boolean;
  v_contact_ids uuid[];
  v_campaign_call_ids uuid[];
  v_callback_ids uuid[];
  v_callback_call_ids uuid[];
  v_all_call_ids uuid[];
  v_candidate_leads uuid[];
  v_sole_leads uuid[];
  v_n_leads int := 0;
  v_n_reminders int := 0;
  v_n_transcripts int := 0;
  v_n_calls int := 0;
  v_n_callbacks int := 0;
  v_n_contacts int := 0;
begin
  select organisation_id, (deleted_at is not null)
    into v_org, v_already
    from public.campaigns
    where id = p_campaign_id;

  if v_org is null then
    raise exception 'Campaign % not found', p_campaign_id;
  end if;
  if v_already then
    raise exception 'Campaign % is already deleted', p_campaign_id;
  end if;

  -- Footprint of this campaign.
  v_contact_ids := array(
    select id from public.campaign_contacts where campaign_id = p_campaign_id
  );
  v_campaign_call_ids := array(
    select id from public.calls where campaign_contact_id = any(v_contact_ids)
  );
  -- Callbacks spawned from this campaign's calls, and the dials they spawned in
  -- turn (defensive: campaign/outbound calls rarely create scheduled_callbacks,
  -- which are inbound-origin — but include them so the footprint is complete).
  v_callback_ids := array(
    select id from public.scheduled_callbacks
    where source_call_id = any(v_campaign_call_ids)
  );
  v_callback_call_ids := array(
    select id from public.calls where scheduled_callback_id = any(v_callback_ids)
  );
  v_all_call_ids := array(
    select distinct x
    from unnest(v_campaign_call_ids || v_callback_call_ids) as x
  );

  -- Leads this campaign touched (via contact link or any of its calls).
  v_candidate_leads := array(
    select distinct lid from (
      select lead_id as lid from public.campaign_contacts
        where campaign_id = p_campaign_id and lead_id is not null
      union
      select lead_id from public.calls
        where id = any(v_all_call_ids) and lead_id is not null
    ) s
  );

  -- Sole-owned = every call on the lead is inside this campaign's footprint.
  -- A lead with calls outside the footprint (inbound/manual/other campaign)
  -- is left visible; only this campaign's calls on it get hidden below.
  v_sole_leads := array(
    select l from unnest(v_candidate_leads) as l
    where not exists (
      select 1 from public.calls k
      where k.lead_id = l
        and not (k.id = any(v_all_call_ids))
    )
  );

  -- Stamp, child → parent. `deleted_at is null` guards keep it idempotent.
  update public.leads
     set deleted_at = v_now, deleted_by = p_user_id, deletion_batch_id = v_batch
   where id = any(v_sole_leads) and deleted_at is null;
  get diagnostics v_n_leads = row_count;

  update public.reminders
     set deleted_at = v_now, deleted_by = p_user_id, deletion_batch_id = v_batch
   where lead_id = any(v_sole_leads) and deleted_at is null;
  get diagnostics v_n_reminders = row_count;

  update public.call_transcripts
     set deleted_at = v_now, deleted_by = p_user_id, deletion_batch_id = v_batch
   where call_id = any(v_all_call_ids) and deleted_at is null;
  get diagnostics v_n_transcripts = row_count;

  update public.calls
     set deleted_at = v_now, deleted_by = p_user_id, deletion_batch_id = v_batch
   where id = any(v_all_call_ids) and deleted_at is null;
  get diagnostics v_n_calls = row_count;

  -- Cancel any still-live callback so the cron drainer won't dial it.
  update public.scheduled_callbacks
     set deleted_at = v_now,
         deleted_by = p_user_id,
         deletion_batch_id = v_batch,
         status = case when status in ('pending','in_flight') then 'canceled' else status end
   where id = any(v_callback_ids) and deleted_at is null;
  get diagnostics v_n_callbacks = row_count;

  update public.campaign_contacts
     set deleted_at = v_now, deleted_by = p_user_id, deletion_batch_id = v_batch
   where campaign_id = p_campaign_id and deleted_at is null;
  get diagnostics v_n_contacts = row_count;

  update public.campaigns
     set deleted_at = v_now, deleted_by = p_user_id, deletion_batch_id = v_batch
   where id = p_campaign_id;

  return jsonb_build_object(
    'batch_id', v_batch,
    'organisation_id', v_org,
    'leads', v_n_leads,
    'reminders', v_n_reminders,
    'transcripts', v_n_transcripts,
    'calls', v_n_calls,
    'callbacks', v_n_callbacks,
    'contacts', v_n_contacts
  );
end $$;

-- -----------------------------------------------------------------------------
-- 5. restore_campaign_deletion(batch_id) — service-role only, no org UI.
--    Clears the stamps for a batch. NOTE: a callback whose status we flipped to
--    'canceled' keeps that status on restore (its prior status isn't recorded);
--    an operator can re-arm it manually if needed.
-- -----------------------------------------------------------------------------

create or replace function public.restore_campaign_deletion(
  p_batch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
  v_total int := 0;
  v_n int := 0;
begin
  foreach t in array array[
    'leads',
    'reminders',
    'call_transcripts',
    'calls',
    'scheduled_callbacks',
    'campaign_contacts',
    'campaigns'
  ]
  loop
    execute format(
      'update public.%I set deleted_at = null, deleted_by = null, deletion_batch_id = null where deletion_batch_id = $1',
      t
    ) using p_batch_id;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end loop;

  return jsonb_build_object('batch_id', p_batch_id, 'restored_rows', v_total);
end $$;

-- -----------------------------------------------------------------------------
-- 6. Lock both functions to service-role. They mutate across tenants and run
--    SECURITY DEFINER, so no client/anon/authenticated caller may invoke them.
-- -----------------------------------------------------------------------------

revoke execute on function public.soft_delete_campaign(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.soft_delete_campaign(uuid, uuid)
  to service_role;

revoke execute on function public.restore_campaign_deletion(uuid)
  from public, anon, authenticated;
grant execute on function public.restore_campaign_deletion(uuid)
  to service_role;

comment on function public.soft_delete_campaign(uuid, uuid) is
  'Soft-deletes a campaign and its footprint (contacts, calls, transcripts, spawned callbacks, sole-owned leads + their reminders) under one deletion_batch_id. Service-role only; the server action verifies org ownership first.';
comment on function public.restore_campaign_deletion(uuid) is
  'Reverses soft_delete_campaign for a deletion_batch_id (admin/support only). Does not restore a callback status that was flipped to canceled.';
