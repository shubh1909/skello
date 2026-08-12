-- =============================================================================
-- Intent mix comes from CALL EXTRACTIONS, not from `leads.current_intent`.
--
-- Supersedes the hot/warm/cold half of 20260811000000. Calls and new-lead
-- counts are unchanged; only the intent source and its bucketing differ.
-- The function is redefined in full because
-- CREATE OR REPLACE takes a whole body — which also means this migration
-- converges the function to a known state whatever the previous one left
-- behind.
--
-- WHY THE OLD SOURCE WAS WRONG
--
-- Intent has exactly one origin in this product: the voice agent's extraction,
-- stored on `calls.lead_intent_extracted` and rolled up onto
-- `leads.current_intent` by lib/bolna/lead-merge.ts. Shopify contributes none
-- of it — a cart nobody rang has no temperature.
--
-- Three sources were considered; two were rejected on evidence:
--
--   * `leads.current_intent` bucketed by `leads.created_at` (what 20260811000000
--     did) — dates a lead by when it was CREATED, not when it was classified.
--     A cart abandoned in June and called this morning lands in June, and a
--     14-day view shows nothing for a conversation that just happened. In real
--     estate and campaign work, where leads sit for weeks before anyone talks
--     to them, that is the normal case rather than an edge one.
--
--   * `leads.current_intent` bucketed by `leads.last_contact_at` — looks like
--     the "we spoke to them" marker and is not: lib/shopify/lead.ts stamps it
--     on every cart create AND update, where nobody was contacted.
--
--   * counting call ROWS — a lead called three times would count three times
--     in a chart whose centre reads "leads".
--
-- DISTINCT ON (lead_id) keeps each lead's most recent classifying call inside
-- the window. That counts LEADS, dated by the conversation that classified
-- them — and it does not depend on the roll-up onto `leads.current_intent`
-- having worked, so a broken merge can no longer empty the chart silently.
--
-- Signature is unchanged (same OUT column names and types), which is what lets
-- CREATE OR REPLACE work here — Postgres refuses to replace a function whose
-- return shape moved.
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
  nl as (
    select
      date_trunc((select u from unit), created_at) as bucket,
      count(*)                                     as new_leads
    from public.leads
    where organisation_id = p_org_id
      and (p_from is null or created_at >= p_from)
    group by 1
  ),
  im as (
    select
      date_trunc((select u from unit), x.started_at)          as bucket,
      count(*) filter (where x.lead_intent_extracted = 'hot')  as hot,
      count(*) filter (where x.lead_intent_extracted = 'warm') as warm,
      count(*) filter (where x.lead_intent_extracted = 'cold') as cold
    from (
      select distinct on (c2.lead_id)
        c2.lead_id, c2.started_at, c2.lead_intent_extracted
      from public.calls c2
      where c2.organisation_id = p_org_id
        and c2.lead_id is not null
        and c2.lead_intent_extracted is not null
        and (p_from is null or c2.started_at >= p_from)
      order by c2.lead_id, c2.started_at desc
    ) x
    group by 1
  ),
  -- The union of every bucket any source produced. A day can have calls but no
  -- new leads, or new leads but no classified conversation; joining on one
  -- side would drop whichever was quiet, which is precisely the day worth
  -- seeing.
  b as (
    select bucket from c
    union
    select bucket from nl
    union
    select bucket from im
  )
  select
    b.bucket,
    coalesce(c.calls, 0),
    coalesce(c.connected, 0),
    coalesce(nl.new_leads, 0),
    coalesce(im.hot, 0),
    coalesce(im.warm, 0),
    coalesce(im.cold, 0)
  from b
  left join c  on c.bucket  = b.bucket
  left join nl on nl.bucket = b.bucket
  left join im on im.bucket = b.bucket
  order by 1;
$$;

comment on function public.dashboard_activity_series(uuid, timestamptz, text) is
  'Per-day or per-month call and lead counts for one organisation. Calls and '
  'new leads are bucketed by their own timestamps; hot/warm/cold count LEADS '
  'classified by a call extraction, dated by that call. Exists so the '
  'dashboard is not limited by PostgREST max-rows, which silently capped the '
  'previous row-fetching implementation at 1000 records.';

-- Supports the DISTINCT ON above: filter by org, then walk each lead's calls
-- newest-first. Partial, because classified calls are a small subset and the
-- intent query is the only reader — a full index here would be mostly rows it
-- never looks at.
create index if not exists calls_org_lead_intent_idx
  on public.calls (organisation_id, lead_id, started_at desc)
  where lead_intent_extracted is not null;
