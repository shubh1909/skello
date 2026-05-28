-- =============================================================================
-- 20260527000002 — Add calls.is_test flag for demo / sales-engineering dials.
-- =============================================================================
-- The Campaigns page surfaces a "Test call" dialog so an operator can fire a
-- live call from the voice agent during a client demo without spinning up a
-- lead or campaign. Those dials need to be:
--   * persisted (transcript + recording must be replayable afterwards)
--   * isolated from real metrics (lifetime stat cards, "Leads contacted")
--   * prevented from auto-creating leads when the post-call webhook fires
--
-- A single boolean on `calls` is enough — the webhook short-circuits the
-- lead-merge when this flag is set, and the stats query filters on it.
-- =============================================================================

alter table public.calls
  add column if not exists is_test boolean not null default false;

comment on column public.calls.is_test is
  'True when the row originated from the Campaigns > Test Call dialog. ' ||
  'The outbound webhook skips lead-merge for these rows so demo dials do ' ||
  'not create real leads, and the lifetime stat cards exclude them by ' ||
  'default to keep "Leads contacted" / "Outbound calls" honest.';

-- Partial index on (organisation_id) WHERE is_test = false. Real-call
-- counts dominate the query mix; a partial keeps the index small and the
-- planner pinned to it for the common case. The full org index still
-- covers test-inclusive scans (e.g. the Test Call history view).
create index if not exists calls_org_real_only_idx
  on public.calls (organisation_id, started_at desc)
  where is_test = false;
