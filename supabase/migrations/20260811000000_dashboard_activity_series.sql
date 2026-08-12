-- =============================================================================
-- Dashboard activity series — aggregate in the database, not in Node.
--
-- WHY THIS EXISTS
--
-- The dashboard aggregator fetched raw rows and counted them in JS. PostgREST
-- caps every response at its `max-rows` setting (1000 on this project), and
-- that cap is applied SILENTLY — `.limit(10000)` still returns 1000 rows with
-- no error and no header the client checks. So a workspace with 40,000 leads
-- rendered "New leads: 1,000", and because those 1,000 were the most RECENT
-- rows, an all-time chart drew a single bar in the newest bucket with empty
-- months behind it. Every number on the page was wrong in the same direction
-- and none of them looked wrong.
--
-- Counting in SQL removes the ceiling entirely: one row per bucket comes back,
-- so the response is bounded by the number of days or months on screen rather
-- than by how much history the tenant has.
--
-- SECURITY INVOKER, deliberately. RLS on `calls` and `leads` still applies to
-- the caller, so this cannot become a cross-tenant read even if p_org_id is
-- wrong — the org filter here is the primary gate (Law #1) and RLS is the net
-- underneath it, exactly as with the equivalent hand-written queries.
--
-- TIMEZONE: date_trunc runs in the session timezone (UTC on the server) and
-- the client builds its bucket keys from UTC ISO slices. The two must agree,
-- or every row lands one bucket off for half the day.
--
-- ⚠️ SUPERSEDED IN PART. The hot/warm/cold half of this function was replaced
-- by 20260811000001, which sources intent from call extractions instead of
-- `leads.current_intent`. This file is kept exactly as it was applied — a
-- migration that has run is a record of what happened, not a place to edit.
-- =============================================================================

create or replace function public.dashboard_activity_series(
  p_org_id uuid,
  p_from   timestamptz default null,  -- null = all time
  p_unit   text        default 'day'  -- 'day' | 'month'
)
returns table (
  bucket    timestamptz,
  calls     bigint,
  connected bigint,
  new_leads bigint,
  hot       bigint,
  warm      bigint,
  cold      bigint
)
language sql
security invoker
stable
as $$
  with unit as (
    -- Whitelisted rather than interpolated. date_trunc takes its field as
    -- text, so an unchecked p_unit would be a value we hand straight to a
    -- system function; anything unexpected collapses to 'day'.
    select case when p_unit = 'month' then 'month' else 'day' end as u
  ),
  c as (
    select
      date_trunc((select u from unit), started_at) as bucket,
      count(*)                                      as calls,
      count(*) filter (where status = 'completed')  as connected
    from public.calls
    where organisation_id = p_org_id
      and (p_from is null or started_at >= p_from)
    group by 1
  ),
  l as (
    select
      date_trunc((select u from unit), created_at)       as bucket,
      count(*)                                            as new_leads,
      count(*) filter (where current_intent = 'hot')      as hot,
      count(*) filter (where current_intent = 'warm')     as warm,
      count(*) filter (where current_intent = 'cold')     as cold
    from public.leads
    where organisation_id = p_org_id
      and (p_from is null or created_at >= p_from)
    group by 1
  )
  -- FULL OUTER JOIN: a bucket can have calls but no new leads, or the
  -- reverse. An inner join would drop whichever side was quiet that day,
  -- which is precisely the day worth seeing.
  select
    coalesce(c.bucket, l.bucket) as bucket,
    coalesce(c.calls, 0),
    coalesce(c.connected, 0),
    coalesce(l.new_leads, 0),
    coalesce(l.hot, 0),
    coalesce(l.warm, 0),
    coalesce(l.cold, 0)
  from c
  full outer join l on c.bucket = l.bucket
  order by 1;
$$;

comment on function public.dashboard_activity_series(uuid, timestamptz, text) is
  'Per-day or per-month call and lead counts for one organisation. Exists so '
  'the dashboard is not limited by PostgREST max-rows, which silently capped '
  'the previous row-fetching implementation at 1000 records.';

-- -----------------------------------------------------------------------------
-- Call outcomes — same reasoning, different grouping. The "how calls are
-- ending" panel counted statuses over the same capped row fetch, so on a busy
-- tenant it described the most recent 1000 calls and labelled them "all time".
-- -----------------------------------------------------------------------------
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

-- The aggregate scans filter on (organisation_id, created_at) for leads; calls
-- already has calls_org_started_at_idx. Without this the all-time variant is a
-- full tenant scan on every dashboard load.
create index if not exists leads_org_created_at_idx
  on public.leads (organisation_id, created_at desc);
