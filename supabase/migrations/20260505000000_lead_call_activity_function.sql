-- lead_call_activity: per-org, deduplicated by normalized phone.
--
-- Returns one row per unique phone in the org, with the canonical lead row
-- (most recent created_at) and aggregated call counts/durations across ALL
-- calls in the org whose counterparty phone normalizes to the same value,
-- regardless of whether the call has a `lead_id`. This replaces the
-- previous in-memory aggregation in src/actions/lead-activity.ts which had
-- a hard 10k-call cap and didn't normalize phone strings.
--
-- Counterparty phone:
--   inbound  → calls.from_phone (the caller)
--   outbound → calls.to_phone   (the lead being dialed)
-- Normalization: strip every non-digit character. Same on both sides so
--   "+91 99999-00000" and "919999900000" merge into one bucket.
--
-- Authorization: `security invoker` so RLS on `leads` and `calls`
-- continues to gate cross-tenant reads. The Server Action also verifies
-- ownership before invoking the function.

create or replace function public.lead_call_activity(
  p_org_id            uuid,
  p_org_slug          text,
  p_include_zero_calls boolean default false,
  p_limit             int default 200
)
returns table (
  id                          uuid,
  created_at                  timestamptz,
  updated_at                  timestamptz,
  org_slug                    text,
  external_id                 text,
  name                        text,
  interest                    text,
  summary                     text,
  lead_intent                 public.intent_type,
  visit_date_time             timestamptz,
  customer_status             text,
  phone                       text,
  wants_to_connect_on_watsapp boolean,
  pending_action              boolean,
  source                      public.lead_source,
  status                      public.lead_status,
  notes                       text,
  city                        text,
  pincode                     text,
  actionable                  text,
  recording_url               text,
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
  with call_norms as (
    select
      regexp_replace(
        coalesce(
          case when direction = 'inbound' then from_phone else to_phone end,
          ''
        ),
        '[^0-9]', '', 'g'
      ) as phone_norm,
      direction,
      started_at,
      coalesce(duration_seconds, 0) as duration_seconds
    from public.calls
    where organisation_id = p_org_id
  ),
  call_aggs as (
    select
      phone_norm,
      count(*) filter (where direction = 'inbound')  as inbound_calls,
      count(*) filter (where direction = 'outbound') as outbound_calls,
      count(*)                                       as total_calls,
      max(started_at)                                as last_call_at,
      min(started_at)                                as first_call_at,
      sum(duration_seconds)                          as total_duration_seconds
    from call_norms
    where phone_norm <> ''
    group by phone_norm
  ),
  leads_ranked as (
    select
      l.*,
      regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g') as phone_norm,
      row_number() over (
        partition by regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g')
        order by l.created_at desc
      ) as rn
    from public.leads l
    where l.org_slug = p_org_slug
      and l.phone is not null
      and l.phone <> ''
  ),
  canonical_leads as (
    select * from leads_ranked where rn = 1
  )
  select
    cl.id, cl.created_at, cl.updated_at, cl.org_slug, cl.external_id,
    cl.name, cl.interest, cl.summary, cl.lead_intent, cl.visit_date_time,
    cl.customer_status, cl.phone, cl.wants_to_connect_on_watsapp,
    cl.pending_action, cl.source, cl.status, cl.notes, cl.city, cl.pincode,
    cl.actionable, cl.recording_url,
    coalesce(ca.inbound_calls, 0)::bigint           as inbound_calls,
    coalesce(ca.outbound_calls, 0)::bigint          as outbound_calls,
    coalesce(ca.total_calls, 0)::bigint             as total_calls,
    ca.last_call_at,
    ca.first_call_at,
    coalesce(ca.total_duration_seconds, 0)::bigint  as total_duration_seconds
  from canonical_leads cl
  left join call_aggs ca on ca.phone_norm = cl.phone_norm
  where p_include_zero_calls or coalesce(ca.total_calls, 0) > 0
  order by total_calls desc, last_call_at desc nulls last, cl.created_at desc
  limit p_limit;
$$;

grant execute on function public.lead_call_activity(uuid, text, boolean, int)
  to authenticated;

-- Helper indexes for the function. The leads(org_slug, phone) and
-- calls(organisation_id, ...) indexes already exist; add an expression
-- index on the normalized counterparty so phone-grouping doesn't scan.
create index if not exists calls_counterparty_norm_idx
  on public.calls (
    organisation_id,
    regexp_replace(
      coalesce(
        case when direction = 'inbound' then from_phone else to_phone end,
        ''
      ),
      '[^0-9]', '', 'g'
    )
  );

create index if not exists leads_phone_norm_idx
  on public.leads (
    org_slug,
    regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')
  );
