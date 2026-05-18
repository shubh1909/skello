-- =============================================================================
-- Post-cleanup follow-up.
--
-- The lead_call_activity RPC created in 20260517000001 references
-- `l.lead_intent`, which was dropped in 20260517000003. This re-deploys
-- the RPC with the correct column and removes the back-compat shape that
-- exposed several now-dropped fields. Also drops the per-row aliases for
-- columns the application no longer reads from `leads` (interest, summary,
-- actionable, etc.) — those values now live on individual `calls` rows.
--
-- New shape:
--   The function returns the lead's CURRENT state. Per-call snapshots are
--   left for the caller to fetch via the `calls` table when they need
--   per-conversation history (e.g. the lead detail "Activity" tab).
-- =============================================================================

drop function if exists public.lead_call_activity(uuid, text, boolean, int, int);

create or replace function public.lead_call_activity(
  p_org_id             uuid,
  p_org_slug           text,
  p_include_zero_calls boolean default false,
  p_limit              int default 10,
  p_offset             int default 0
)
returns table (
  id                          uuid,
  created_at                  timestamptz,
  updated_at                  timestamptz,
  organisation_id             uuid,
  org_slug                    text,
  name                        text,
  phone                        text,
  phone_normalized            text,
  first_seen_at               timestamptz,
  last_contact_at             timestamptz,
  current_intent              public.intent_type,
  city                        text,
  pincode                     text,
  notes                       text,
  source                      public.lead_source,
  status                      public.lead_status,
  pending_action              boolean,
  lead_data                   jsonb,
  custom_data                 jsonb,
  -- Per-call snapshot from the most recent call (for quick at-a-glance
  -- "what was on the latest call" info on the leads list).
  latest_call_interest        text,
  latest_call_summary         text,
  latest_call_recording_url   text,
  -- Aggregates.
  inbound_calls               bigint,
  outbound_calls              bigint,
  total_calls                 bigint,
  last_call_at                timestamptz,
  first_call_at               timestamptz,
  total_duration_seconds      bigint
)
language sql
security invoker
stable
as $$
  with call_aggs as (
    select
      l.id as lead_id,
      count(*) filter (where c.direction = 'inbound')  as inbound_calls,
      count(*) filter (where c.direction = 'outbound') as outbound_calls,
      count(c.id)                                      as total_calls,
      max(c.started_at)                                as last_call_at,
      min(c.started_at)                                as first_call_at,
      coalesce(sum(c.duration_seconds), 0)             as total_duration_seconds
    from public.leads l
    left join public.calls c on c.lead_id = l.id
    where l.organisation_id = p_org_id
    group by l.id
  ),
  latest_call as (
    select distinct on (c.lead_id)
      c.lead_id,
      c.interest      as latest_call_interest,
      c.summary       as latest_call_summary,
      c.recording_url as latest_call_recording_url
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where l.organisation_id = p_org_id
    order by c.lead_id, c.started_at desc
  )
  select
    l.id, l.created_at, l.updated_at,
    l.organisation_id, l.org_slug,
    l.name, l.phone, l.phone_normalized,
    l.first_seen_at, l.last_contact_at,
    l.current_intent,
    l.city, l.pincode, l.notes,
    l.source, l.status, l.pending_action,
    l.lead_data, l.custom_data,
    lc.latest_call_interest,
    lc.latest_call_summary,
    lc.latest_call_recording_url,
    coalesce(ca.inbound_calls, 0)::bigint           as inbound_calls,
    coalesce(ca.outbound_calls, 0)::bigint          as outbound_calls,
    coalesce(ca.total_calls, 0)::bigint             as total_calls,
    ca.last_call_at,
    ca.first_call_at,
    coalesce(ca.total_duration_seconds, 0)::bigint  as total_duration_seconds
  from public.leads l
  left join call_aggs   ca on ca.lead_id = l.id
  left join latest_call lc on lc.lead_id = l.id
  where l.organisation_id = p_org_id
    and (p_include_zero_calls or coalesce(ca.total_calls, 0) > 0)
  order by ca.total_calls desc nulls last, ca.last_call_at desc nulls last, l.created_at desc
  limit p_limit
  offset p_offset;
$$;

grant execute on function public.lead_call_activity(uuid, text, boolean, int, int)
  to authenticated;
