-- =============================================================================
-- Phase 2 — Lead / Call Remodel.
--
-- Before:
--   - `leads` was keyed by (org_slug, external_id) where external_id was a
--     per-CALL identifier. Two calls from the same number → two lead rows.
--   - Per-call variables (name, interest, intent, summary, recording_url,
--     actionable, customer_status) lived on `leads`, so each duplicate held
--     a different snapshot — fragile, with the read path papering over it
--     via a `partition by phone_norm` in lead_call_activity().
--
-- After:
--   - One lead per (organisation_id, phone_normalized). Lead row holds the
--     current/canonical view (latest non-null wins; admin edits via the
--     override table take precedence over future webhooks).
--   - Per-call snapshots live on `calls` (name_extracted, interest, etc.).
--   - lead_field_overrides table records every admin edit (append-only),
--     with `action ∈ {'set','unlock'}`. The webhook ingest consults this
--     table to know which fields the LLM is muted on.
--
-- This migration is destructive on duplicates: collapsing N leads-per-phone
-- to 1. The backfill is in a single transaction so a failure rolls back the
-- whole thing. See docs/migration-testing.md for the dry-run procedure.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 1 — Add new columns on `calls` to receive moved per-call fields.
-- -----------------------------------------------------------------------------

alter table public.calls
  add column if not exists name_extracted        text,
  add column if not exists interest              text,
  add column if not exists lead_intent_extracted public.intent_type,
  add column if not exists actionable            text,
  add column if not exists customer_status       text,
  add column if not exists visit_scheduled_at    timestamptz,
  add column if not exists connect_on_whatsapp   boolean;

-- -----------------------------------------------------------------------------
-- STEP 2 — Add new columns on `leads`.
--   organisation_id becomes the FK tenancy gate; org_slug stays as a
--   denormalized convenience column for one release (cleanup migration
--   drops it). phone_normalized is a generated column derived from phone
--   so the unique constraint stays in sync without trigger gymnastics.
-- -----------------------------------------------------------------------------

alter table public.leads
  add column if not exists organisation_id  uuid references public.organisations (id) on delete cascade,
  add column if not exists phone_normalized text generated always as (
    nullif(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '')
  ) stored,
  add column if not exists first_seen_at    timestamptz,
  add column if not exists last_contact_at  timestamptz,
  add column if not exists current_intent   public.intent_type;

-- -----------------------------------------------------------------------------
-- STEP 3 — Backfill organisation_id from org_slug.
-- -----------------------------------------------------------------------------

update public.leads l
set organisation_id = o.id
from public.organisations o
where l.org_slug = o.slug
  and l.organisation_id is null;

-- -----------------------------------------------------------------------------
-- STEP 4 — Backfill first_seen_at / last_contact_at from existing data.
--   first_seen_at = earliest created_at across leads sharing the same
--   (org, phone_norm). last_contact_at = the most recent call's started_at
--   for that grouping, falling back to lead.updated_at if no calls exist.
-- -----------------------------------------------------------------------------

with grp as (
  select
    organisation_id,
    phone_normalized,
    min(created_at) as min_created
  from public.leads
  where organisation_id is not null and phone_normalized is not null
  group by organisation_id, phone_normalized
)
update public.leads l
set first_seen_at = grp.min_created
from grp
where grp.organisation_id = l.organisation_id
  and grp.phone_normalized = l.phone_normalized;

update public.leads
set first_seen_at = created_at
where first_seen_at is null;

with last_call as (
  select
    c.organisation_id,
    regexp_replace(
      coalesce(
        case when c.direction = 'inbound' then c.from_phone else c.to_phone end,
        ''
      ),
      '[^0-9]', '', 'g'
    ) as phone_norm,
    max(c.started_at) as last_at
  from public.calls c
  group by 1, 2
)
update public.leads l
set last_contact_at = lc.last_at
from last_call lc
where lc.organisation_id = l.organisation_id
  and lc.phone_norm = l.phone_normalized
  and l.last_contact_at is null;

update public.leads
set last_contact_at = updated_at
where last_contact_at is null;

-- -----------------------------------------------------------------------------
-- STEP 5 — current_intent seeded from the existing lead_intent column.
-- -----------------------------------------------------------------------------

update public.leads
set current_intent = lead_intent
where current_intent is null and lead_intent is not null;

-- -----------------------------------------------------------------------------
-- STEP 6 — Move per-call fields from leads onto matching calls rows.
--   A lead has a `external_id` pointing at the call that created it; that's
--   the call that should receive the lead's per-call snapshot. If the call
--   row doesn't exist (e.g. webhook dropped mid-flight), create a synthetic
--   row so no data is lost.
-- -----------------------------------------------------------------------------

update public.calls c
set
  name_extracted        = coalesce(c.name_extracted, l.name),
  interest              = coalesce(c.interest, l.interest),
  lead_intent_extracted = coalesce(c.lead_intent_extracted, l.lead_intent),
  actionable            = coalesce(c.actionable, l.actionable),
  customer_status       = coalesce(c.customer_status, l.customer_status),
  visit_scheduled_at    = coalesce(c.visit_scheduled_at, l.visit_date_time),
  connect_on_whatsapp   = coalesce(c.connect_on_whatsapp, l.wants_to_connect_on_watsapp),
  summary               = coalesce(c.summary, l.summary),
  recording_url         = coalesce(c.recording_url, l.recording_url)
from public.leads l
where l.external_id is not null
  and l.organisation_id is not null
  and c.bolna_call_id = l.external_id
  and c.organisation_id = l.organisation_id;

-- Synthetic call rows for leads whose external_id never matched a calls row.
-- Skipped for leads with no external_id (manual / import / web_form sources).
insert into public.calls (
  organisation_id,
  lead_id,
  bolna_call_id,
  to_phone,
  from_phone,
  agent_id,
  status,
  direction,
  started_at,
  name_extracted,
  interest,
  lead_intent_extracted,
  actionable,
  customer_status,
  visit_scheduled_at,
  connect_on_whatsapp,
  summary,
  recording_url
)
select
  l.organisation_id,
  l.id,
  l.external_id,
  null,
  l.phone,
  'unknown',
  'completed',
  case when l.source = 'inbound_call' then 'inbound'::public.call_direction
       else 'outbound'::public.call_direction end,
  l.created_at,
  l.name,
  l.interest,
  l.lead_intent,
  l.actionable,
  l.customer_status,
  l.visit_date_time,
  l.wants_to_connect_on_watsapp,
  l.summary,
  l.recording_url
from public.leads l
where l.external_id is not null
  and l.organisation_id is not null
  and not exists (
    select 1 from public.calls c
    where c.organisation_id = l.organisation_id
      and c.bolna_call_id = l.external_id
  )
on conflict (organisation_id, bolna_call_id) do nothing;

-- -----------------------------------------------------------------------------
-- STEP 7 — Collapse duplicate leads.
--   For every (organisation_id, phone_normalized) group with >1 lead:
--     - canonical = earliest created_at (preserves first_seen_at semantics).
--     - merge per "latest non-null wins" for current-state fields onto canonical.
--     - re-point any reminders.lead_id from duplicates → canonical.
--     - re-point any calls.lead_id from duplicates → canonical.
--     - delete the duplicates.
-- -----------------------------------------------------------------------------

with grouped as (
  select
    id,
    organisation_id,
    phone_normalized,
    created_at,
    row_number() over (
      partition by organisation_id, phone_normalized
      order by created_at asc, id asc
    ) as rn
  from public.leads
  where organisation_id is not null and phone_normalized is not null
),
canonical as (
  select id as canon_id, organisation_id, phone_normalized
  from grouped where rn = 1
),
dup_to_canon as (
  select g.id as dup_id, c.canon_id
  from grouped g
  join canonical c
    on c.organisation_id = g.organisation_id
   and c.phone_normalized = g.phone_normalized
  where g.rn > 1
),
-- Latest non-null per canonical for each "current state" field, picking the
-- value from the most recently updated row in the group (canonical or dup).
latest_state as (
  select
    c.canon_id,
    (array_agg(l.name           order by l.updated_at desc) filter (where l.name is not null))[1]            as name,
    (array_agg(l.notes          order by l.updated_at desc) filter (where l.notes is not null))[1]           as notes,
    (array_agg(l.city           order by l.updated_at desc) filter (where l.city is not null))[1]            as city,
    (array_agg(l.pincode        order by l.updated_at desc) filter (where l.pincode is not null))[1]         as pincode,
    (array_agg(l.lead_intent    order by l.updated_at desc) filter (where l.lead_intent is not null))[1]     as lead_intent,
    (array_agg(l.customer_status order by l.updated_at desc) filter (where l.customer_status is not null))[1] as customer_status,
    (array_agg(l.status         order by l.updated_at desc))[1]                                              as status,
    bool_or(l.pending_action)                                                                                as pending_action
  from canonical c
  join public.leads l
    on l.organisation_id = c.organisation_id
   and l.phone_normalized = c.phone_normalized
  group by c.canon_id
)
update public.leads tgt
set
  name            = coalesce(ls.name,            tgt.name),
  notes           = coalesce(ls.notes,           tgt.notes),
  city            = coalesce(ls.city,            tgt.city),
  pincode         = coalesce(ls.pincode,         tgt.pincode),
  current_intent  = coalesce(ls.lead_intent,     tgt.current_intent),
  customer_status = coalesce(ls.customer_status, tgt.customer_status),
  status          = coalesce(ls.status,          tgt.status),
  pending_action  = coalesce(ls.pending_action,  tgt.pending_action)
from latest_state ls
where tgt.id = ls.canon_id;

-- Re-point reminders to the canonical lead.
with grouped as (
  select
    id,
    organisation_id,
    phone_normalized,
    row_number() over (
      partition by organisation_id, phone_normalized
      order by created_at asc, id asc
    ) as rn
  from public.leads
  where organisation_id is not null and phone_normalized is not null
),
canonical as (
  select id as canon_id, organisation_id, phone_normalized
  from grouped where rn = 1
),
dup_to_canon as (
  select g.id as dup_id, c.canon_id
  from grouped g
  join canonical c
    on c.organisation_id = g.organisation_id
   and c.phone_normalized = g.phone_normalized
  where g.rn > 1
)
update public.reminders r
set lead_id = d.canon_id
from dup_to_canon d
where r.lead_id = d.dup_id;

-- Re-point calls to the canonical lead.
with grouped as (
  select
    id,
    organisation_id,
    phone_normalized,
    row_number() over (
      partition by organisation_id, phone_normalized
      order by created_at asc, id asc
    ) as rn
  from public.leads
  where organisation_id is not null and phone_normalized is not null
),
canonical as (
  select id as canon_id, organisation_id, phone_normalized
  from grouped where rn = 1
),
dup_to_canon as (
  select g.id as dup_id, c.canon_id
  from grouped g
  join canonical c
    on c.organisation_id = g.organisation_id
   and c.phone_normalized = g.phone_normalized
  where g.rn > 1
)
update public.calls c
set lead_id = d.canon_id
from dup_to_canon d
where c.lead_id = d.dup_id;

-- Finally, delete the duplicate lead rows.
with grouped as (
  select
    id,
    organisation_id,
    phone_normalized,
    row_number() over (
      partition by organisation_id, phone_normalized
      order by created_at asc, id asc
    ) as rn
  from public.leads
  where organisation_id is not null and phone_normalized is not null
)
delete from public.leads
where id in (select id from grouped where rn > 1);

-- -----------------------------------------------------------------------------
-- STEP 8 — Enforce the new uniqueness contract.
--   One lead per (organisation_id, phone_normalized) where phone is present.
--   Leads with NULL phone (rare manual entries pre-phone) coexist; Postgres
--   treats NULLs as distinct.
-- -----------------------------------------------------------------------------

create unique index if not exists leads_org_phone_norm_unique_idx
  on public.leads (organisation_id, phone_normalized)
  where phone_normalized is not null;

create index if not exists leads_organisation_id_idx
  on public.leads (organisation_id);

create index if not exists leads_org_last_contact_idx
  on public.leads (organisation_id, last_contact_at desc nulls last);

-- -----------------------------------------------------------------------------
-- STEP 9 — lead_field_overrides table (append-only audit log + lock list).
--   Each row is an EVENT, not a current value. The "currently locked"
--   set for a lead is "field_paths whose most recent row has action='set'".
--   action='unlock' inserts a tombstone event so the LLM can write again.
--   value/previous_value are jsonb so this works for any field type
--   (string, number, boolean, date, nested object in lead_data/custom_data).
-- -----------------------------------------------------------------------------

create table if not exists public.lead_field_overrides (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references public.leads (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  field_path      text not null check (char_length(field_path) between 1 and 200),
  action          text not null check (action in ('set', 'unlock')),
  value           jsonb,
  previous_value  jsonb,
  reason          text check (reason is null or char_length(reason) between 1 and 500),
  edited_by       uuid references auth.users (id) on delete set null,
  edited_at       timestamptz not null default now()
);

create index if not exists lead_field_overrides_lead_idx
  on public.lead_field_overrides (lead_id, edited_at desc);
create index if not exists lead_field_overrides_org_idx
  on public.lead_field_overrides (organisation_id, edited_at desc);
-- Hot-path query: "which fields are currently locked for this lead?"
-- Uses (lead_id, field_path, edited_at desc) with DISTINCT ON.
create index if not exists lead_field_overrides_lock_lookup_idx
  on public.lead_field_overrides (lead_id, field_path, edited_at desc);

alter table public.lead_field_overrides enable row level security;

drop policy if exists "lead_field_overrides_select_own_org" on public.lead_field_overrides;
create policy "lead_field_overrides_select_own_org"
  on public.lead_field_overrides for select
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "lead_field_overrides_insert_own_org" on public.lead_field_overrides;
create policy "lead_field_overrides_insert_own_org"
  on public.lead_field_overrides for insert
  to authenticated
  with check (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );
-- Append-only: no update / delete policies. History is immutable.

-- -----------------------------------------------------------------------------
-- STEP 10 — Helper: which field_paths are currently locked for a lead?
--   Returns the set of field_paths whose most recent override row is action='set'.
--   Used by the webhook ingest to decide which fields to skip on a merge.
-- -----------------------------------------------------------------------------

create or replace function public.lead_locked_fields(p_lead_id uuid)
returns table (field_path text)
language sql
security definer
stable
set search_path = public
as $$
  select field_path
  from (
    select distinct on (field_path)
      field_path,
      action
    from public.lead_field_overrides
    where lead_id = p_lead_id
    order by field_path, edited_at desc
  ) latest
  where action = 'set';
$$;

grant execute on function public.lead_locked_fields(uuid)
  to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- STEP 11 — Update lead_call_activity RPC.
--   Now that leads is pre-deduped, the partition-by-phone_norm dance is gone.
--   The RPC just joins leads → call_aggs directly. Read path gets simpler and
--   measurably faster.
--
--   We keep the function signature compatible with the existing caller in
--   src/actions/lead-activity.ts (p_org_slug stays as a no-op for now;
--   tenancy is gated on p_org_id). Caller will be updated in a follow-up.
-- -----------------------------------------------------------------------------

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
  )
  select
    l.id, l.created_at, l.updated_at, l.org_slug, l.external_id,
    l.name, l.interest, l.summary,
    coalesce(l.current_intent, l.lead_intent) as lead_intent,
    l.visit_date_time, l.customer_status, l.phone,
    l.wants_to_connect_on_watsapp,
    l.pending_action, l.source, l.status, l.notes, l.city, l.pincode,
    l.actionable, l.recording_url,
    coalesce(ca.inbound_calls, 0)::bigint           as inbound_calls,
    coalesce(ca.outbound_calls, 0)::bigint          as outbound_calls,
    coalesce(ca.total_calls, 0)::bigint             as total_calls,
    ca.last_call_at,
    ca.first_call_at,
    coalesce(ca.total_duration_seconds, 0)::bigint  as total_duration_seconds
  from public.leads l
  left join call_aggs ca on ca.lead_id = l.id
  where l.organisation_id = p_org_id
    and (p_include_zero_calls or coalesce(ca.total_calls, 0) > 0)
  order by ca.total_calls desc nulls last, ca.last_call_at desc nulls last, l.created_at desc
  limit p_limit
  offset p_offset;
$$;

create or replace function public.lead_call_activity_count(
  p_org_id             uuid,
  p_org_slug           text,
  p_include_zero_calls boolean default false
)
returns bigint
language sql
security invoker
stable
as $$
  select count(*)::bigint
  from public.leads l
  where l.organisation_id = p_org_id
    and (
      p_include_zero_calls
      or exists (select 1 from public.calls c where c.lead_id = l.id)
    );
$$;

grant execute on function public.lead_call_activity(uuid, text, boolean, int, int)
  to authenticated;
grant execute on function public.lead_call_activity_count(uuid, text, boolean)
  to authenticated;
