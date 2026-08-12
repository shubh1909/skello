-- =============================================================================
-- Restore dashboard_call_outcomes.
--
-- 20260811000000 created it; 20260811000001 replaced only
-- dashboard_activity_series. Anyone who dropped the first migration's objects
-- wholesale before pushing the second is left without this one, because
-- nothing recreates it — the dashboard then reports "Analytics could not be
-- loaded" while every other figure on the page is correct.
--
-- Identical to the original definition. Idempotent, so it is a no-op on a
-- database that still has it.
-- =============================================================================

create or replace function public.dashboard_call_outcomes(
  p_org_id uuid,
  p_from   timestamptz default null
)
returns table (
  status text,
  total  bigint
)
language sql
security invoker
stable
as $$
  select c.status, count(*) as total
  from public.calls c
  where c.organisation_id = p_org_id
    and (p_from is null or c.started_at >= p_from)
  group by c.status
  order by 2 desc;
$$;

comment on function public.dashboard_call_outcomes(uuid, timestamptz) is
  'Call count per status for one organisation, for the dashboard outcomes '
  'panel. Aggregated in SQL so it is not limited by PostgREST max-rows.';

-- Recreated for the same reason: a wholesale drop of 20260811000000's objects
-- takes the index with it, and the all-time series then full-scans leads on
-- every dashboard load.
create index if not exists leads_org_created_at_idx
  on public.leads (organisation_id, created_at desc);

-- PostgREST resolves RPCs from a cached schema. A function created outside the
-- normal migration path can 404 until that cache refreshes; this makes it
-- immediate rather than leaving someone staring at an error for a function
-- they can see in the database.
notify pgrst, 'reload schema';
