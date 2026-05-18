-- =============================================================================
-- Phase 6 — Cleanup.
--
-- Removes columns made redundant by the lead/call remodel and the voice
-- agents registry. Run ONLY after:
--   1. Phases 0-3 migrations have been applied.
--   2. The application code has been deployed and is no longer reading from
--      the deprecated columns. (See docs/migration-testing.md for the
--      shadow-mode procedure.)
--   3. At least one release cycle of observability has passed.
--
-- This migration is intentionally separated so a rollback of Phases 0-3 is
-- still possible while the deprecated columns are around as a safety net.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- bolna_integrations.agent_ids[] and agent_labels are superseded by the
-- voice_agents registry. The default `agent_id` column stays — it still
-- powers the "default agent for new campaigns" picker. Drop only the
-- extras-array machinery.
-- -----------------------------------------------------------------------------

alter table public.bolna_integrations
  drop constraint if exists bolna_integrations_agent_ids_nonblank;

alter table public.bolna_integrations
  drop column if exists agent_ids,
  drop column if exists agent_labels;

-- -----------------------------------------------------------------------------
-- leads — drop columns moved to `calls` or replaced by JSONB.
--   external_id: was per-call idempotency on leads; now lives only on calls.
--   interest / summary / actionable / recording_url / customer_status /
--   wants_to_connect_on_watsapp / visit_date_time: per-call snapshots,
--   moved to calls.* during Phase 2 backfill.
--   lead_intent: superseded by current_intent (with manual-override semantics).
--
-- Postgres refuses to drop columns that a stored generated column depends
-- on. `leads.search_tsv` (from 20260517000002) references `interest` and
-- `summary`, so we drop the tsvector + its index first, drop the columns,
-- then recreate the tsvector against the trimmed shape (name + notes +
-- lead_data values).
-- -----------------------------------------------------------------------------

drop index if exists public.leads_org_external_idx;
drop index if exists public.leads_phone_norm_idx;
drop index if exists public.leads_org_slug_phone_idx;
drop index if exists public.leads_search_tsv_gin;

alter table public.leads
  drop column if exists search_tsv;

alter table public.leads
  drop column if exists external_id,
  drop column if exists interest,
  drop column if exists summary,
  drop column if exists actionable,
  drop column if exists recording_url,
  drop column if exists customer_status,
  drop column if exists wants_to_connect_on_watsapp,
  drop column if exists visit_date_time,
  drop column if exists lead_intent;

alter table public.leads
  add column if not exists search_tsv tsvector generated always as (
    to_tsvector('simple',
      coalesce(name, '') || ' ' ||
      coalesce(notes, '') || ' ' ||
      coalesce(public.jsonb_values_text(lead_data), '')
    )
  ) stored;

create index if not exists leads_search_tsv_gin
  on public.leads using gin (search_tsv);

-- -----------------------------------------------------------------------------
-- leads.org_slug → keep as denormalized convenience for now, but make
-- organisation_id NOT NULL since all rows are backfilled by Phase 2.
-- -----------------------------------------------------------------------------

alter table public.leads
  alter column organisation_id set not null;

-- -----------------------------------------------------------------------------
-- New RLS policies for leads using organisation_id (the org_slug-based
-- policies stay too, for the transitional org_slug column).
-- -----------------------------------------------------------------------------

drop policy if exists "leads_select_own_org_by_id" on public.leads;
create policy "leads_select_own_org_by_id"
  on public.leads for select
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "leads_insert_own_org_by_id" on public.leads;
create policy "leads_insert_own_org_by_id"
  on public.leads for insert
  to authenticated
  with check (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "leads_update_own_org_by_id" on public.leads;
create policy "leads_update_own_org_by_id"
  on public.leads for update
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

drop policy if exists "leads_delete_own_org_by_id" on public.leads;
create policy "leads_delete_own_org_by_id"
  on public.leads for delete
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );
