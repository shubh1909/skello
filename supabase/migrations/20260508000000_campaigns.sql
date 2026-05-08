-- Campaigns: bulk outbound calling driven by an uploaded CSV.
--
-- Two new tables and one column on `calls`:
--   - campaigns           : one row per uploaded batch + retry config + counters
--   - campaign_contacts   : one row per CSV phone number; lifecycle pending → in_flight → succeeded/failed/skipped
--   - calls.campaign_contact_id : seam between the existing dial pipeline and a campaign run
--
-- Tenant scope is `organisation_id` (uuid) on both new tables, matching the
-- `calls` / `bolna_integrations` / `reminders` convention. Leads still use
-- `org_slug`; lead conversion (on a successful call) resolves slug from the
-- organisation row at write time.
--
-- Counters on `campaigns` are denormalized and maintained by an AFTER trigger
-- on `campaign_contacts` so the table query stays cheap.
--
-- pg_cron + pg_net wiring lives in a companion migration
-- (20260508000001_campaigns_cron.sql) so the schema can be applied even if
-- those extensions aren't yet enabled in the project.

-- -----------------------------------------------------------------------------
-- campaigns
-- -----------------------------------------------------------------------------

create table if not exists public.campaigns (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisations (id) on delete cascade,
  created_by               uuid references auth.users (id) on delete set null,
  name                     text not null check (char_length(name) between 1 and 200),
  file_name                text,
  -- Nullable; when null, the dialer falls back to bolna_integrations.agent_id
  -- for the org. Designed for per-campaign agent selection later.
  agent_id                 text,
  status                   text not null default 'draft'
                             check (status in ('draft','scheduled','in_progress','paused','stopped','completed','failed')),
  scheduled_at             timestamptz,
  started_at               timestamptz,
  completed_at             timestamptz,

  -- Retry config snapshot (frozen at upload, applies to the whole batch).
  -- max_attempts = 1 + retries; UI slider exposes 0..5 retries → 1..6 attempts.
  max_attempts             smallint not null default 1
                             check (max_attempts between 1 and 6),
  retry_interval_seconds   integer not null default 900
                             check (retry_interval_seconds between 60 and 86400),
  retry_on                 text[] not null default '{}'
                             check (retry_on <@ array['no_answer','busy','failed','canceled']),

  -- Denormalized progress counters (kept fresh by trigger below).
  total_contacts           integer not null default 0,
  valid_contacts           integer not null default 0,
  succeeded_count          integer not null default 0,
  failed_count             integer not null default 0,
  in_flight_count          integer not null default 0,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists campaigns_org_created_idx
  on public.campaigns (organisation_id, created_at desc);
create index if not exists campaigns_status_due_idx
  on public.campaigns (status, scheduled_at)
  where status in ('scheduled','in_progress');

drop trigger if exists campaigns_set_updated_at on public.campaigns;
create trigger campaigns_set_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();

alter table public.campaigns enable row level security;

drop policy if exists "campaigns_select_own_org" on public.campaigns;
create policy "campaigns_select_own_org"
  on public.campaigns for select
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "campaigns_insert_own_org" on public.campaigns;
create policy "campaigns_insert_own_org"
  on public.campaigns for insert
  to authenticated
  with check (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "campaigns_update_own_org" on public.campaigns;
create policy "campaigns_update_own_org"
  on public.campaigns for update
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  )
  with check (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "campaigns_delete_own_org" on public.campaigns;
create policy "campaigns_delete_own_org"
  on public.campaigns for delete
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

-- -----------------------------------------------------------------------------
-- campaign_contacts
-- -----------------------------------------------------------------------------

create table if not exists public.campaign_contacts (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references public.campaigns (id) on delete cascade,
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  -- Source row data
  raw_phone        text not null,
  phone            text not null check (char_length(phone) between 5 and 32),
  name             text,
  metadata         jsonb not null default '{}'::jsonb,
  -- Execution state
  status           text not null default 'pending'
                     check (status in ('pending','in_flight','succeeded','failed','skipped')),
  attempt          smallint not null default 0,
  next_attempt_at  timestamptz,
  last_call_id     uuid references public.calls (id) on delete set null,
  last_status      text,
  last_error       text,
  -- Filled in by webhook lead-conversion path on first 'completed' call.
  lead_id          uuid references public.leads (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists campaign_contacts_campaign_idx
  on public.campaign_contacts (campaign_id);
create index if not exists campaign_contacts_org_idx
  on public.campaign_contacts (organisation_id);
create index if not exists campaign_contacts_due_idx
  on public.campaign_contacts (next_attempt_at)
  where status = 'pending';
create unique index if not exists campaign_contacts_dedupe
  on public.campaign_contacts (campaign_id, phone);

drop trigger if exists campaign_contacts_set_updated_at on public.campaign_contacts;
create trigger campaign_contacts_set_updated_at
  before update on public.campaign_contacts
  for each row execute function public.set_updated_at();

alter table public.campaign_contacts enable row level security;

drop policy if exists "campaign_contacts_select_own_org" on public.campaign_contacts;
create policy "campaign_contacts_select_own_org"
  on public.campaign_contacts for select
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "campaign_contacts_insert_own_org" on public.campaign_contacts;
create policy "campaign_contacts_insert_own_org"
  on public.campaign_contacts for insert
  to authenticated
  with check (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "campaign_contacts_update_own_org" on public.campaign_contacts;
create policy "campaign_contacts_update_own_org"
  on public.campaign_contacts for update
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  )
  with check (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "campaign_contacts_delete_own_org" on public.campaign_contacts;
create policy "campaign_contacts_delete_own_org"
  on public.campaign_contacts for delete
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

-- -----------------------------------------------------------------------------
-- calls.campaign_contact_id  (the seam)
-- -----------------------------------------------------------------------------

alter table public.calls
  add column if not exists campaign_contact_id uuid references public.campaign_contacts (id) on delete set null;

create index if not exists calls_campaign_contact_idx
  on public.calls (campaign_contact_id) where campaign_contact_id is not null;

-- -----------------------------------------------------------------------------
-- Counter trigger
-- -----------------------------------------------------------------------------
-- Recomputes counters on the parent campaign after any change to its contacts.
-- Plain SELECT-COUNT subqueries keep this intent-readable; the contacts-per-
-- campaign cardinality is bounded (CSV upload), so this is fine.
-- Auto-completes the campaign once nothing is left pending or in flight.

create or replace function public.campaign_contacts_recompute_counts()
returns trigger
language plpgsql
as $$
declare
  v_cid uuid := coalesce(new.campaign_id, old.campaign_id);
begin
  update public.campaigns c
    set total_contacts  = (select count(*)::int from public.campaign_contacts where campaign_id = v_cid),
        valid_contacts  = (select count(*)::int from public.campaign_contacts where campaign_id = v_cid),
        succeeded_count = (select count(*)::int from public.campaign_contacts where campaign_id = v_cid and status = 'succeeded'),
        failed_count    = (select count(*)::int from public.campaign_contacts where campaign_id = v_cid and status = 'failed'),
        in_flight_count = (select count(*)::int from public.campaign_contacts where campaign_id = v_cid and status = 'in_flight')
    where c.id = v_cid;

  update public.campaigns c
    set status = 'completed',
        completed_at = coalesce(c.completed_at, now())
    where c.id = v_cid
      and c.status = 'in_progress'
      and not exists (
        select 1 from public.campaign_contacts
        where campaign_id = v_cid and status in ('pending','in_flight')
      );

  return null;
end $$;

drop trigger if exists campaign_contacts_after_change on public.campaign_contacts;
create trigger campaign_contacts_after_change
  after insert or update or delete on public.campaign_contacts
  for each row execute function public.campaign_contacts_recompute_counts();

-- -----------------------------------------------------------------------------
-- Realtime publication
-- -----------------------------------------------------------------------------
-- Wrapped in DO blocks so re-runs (and projects where the table is already
-- in the publication) don't error.

do $$
begin
  begin
    alter publication supabase_realtime add table public.campaigns;
  exception when duplicate_object then null;
  end;
end $$;

do $$
begin
  begin
    alter publication supabase_realtime add table public.campaign_contacts;
  exception when duplicate_object then null;
  end;
end $$;
