-- =============================================================================
-- Skelo baseline schema (pre-campaigns).
--
-- This file is a CONSOLIDATION of every migration through 2026-05-05. It
-- captures the FINAL state of the schema and is intended for fresh
-- bootstraps (UAT, local dev, new staging projects).
--
-- For an existing prod database that has the historical migrations applied,
-- this file is fully idempotent — every CREATE uses IF NOT EXISTS and every
-- policy is DROP-then-CREATE. Re-running it on prod is a no-op.
--
-- The campaigns feature lives in two separate, later migrations:
--   - 20260508000000_campaigns.sql
--   - 20260508000001_campaigns_cron.sql
-- so they're easy to read in isolation and to apply on their own.
--
-- One intentional alignment with the TypeScript layer:
--   The original `intent_type` enum was created with capitalized values
--   ('Hot','Warm','Cold'). The application code expects lowercase
--   ('hot','warm','cold'). Prod was hand-aligned at some point; this file
--   bakes the lowercase alignment in.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Shared trigger function: keep updated_at honest.
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- =============================================================================
-- Enums
-- =============================================================================

create type if not exists public.intent_type as enum ('hot', 'warm', 'cold');

create type if not exists public.lead_source as enum (
  'inbound_call',
  'whatsapp',
  'manual',
  'import',
  'web_form'
);

create type if not exists public.lead_status as enum (
  'new',
  'contacted',
  'qualified',
  'negotiating',
  'won',
  'lost'
);

create type if not exists public.call_direction as enum ('inbound', 'outbound');

create type if not exists public.call_transcript_status as enum (
  'pending',
  'processing',
  'ready',
  'failed',
  'skipped'
);

create type if not exists public.call_turn_speaker as enum (
  'agent',
  'user',
  'system'
);

-- =============================================================================
-- organisations — tenant root.
-- =============================================================================

create table if not exists public.organisations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 100),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists organisations_owner_id_idx
  on public.organisations (owner_id);

drop trigger if exists organisations_set_updated_at on public.organisations;
create trigger organisations_set_updated_at
  before update on public.organisations
  for each row execute function public.set_updated_at();

alter table public.organisations enable row level security;

drop policy if exists "organisations_select_own" on public.organisations;
create policy "organisations_select_own"
  on public.organisations for select
  to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "organisations_insert_own" on public.organisations;
create policy "organisations_insert_own"
  on public.organisations for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists "organisations_update_own" on public.organisations;
create policy "organisations_update_own"
  on public.organisations for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "organisations_delete_own" on public.organisations;
create policy "organisations_delete_own"
  on public.organisations for delete
  to authenticated
  using (owner_id = (select auth.uid()));

-- =============================================================================
-- leads — CRM core. Tenant-scoped via `org_slug` (text FK to organisations.slug).
--   Two distinct "status" notions:
--     - `status`           pipeline stage enum
--     - `customer_status`  free-form buyer-type label
--   `lead_intent` is temperature (hot/warm/cold), independent of both.
--   `pending_action` (NOT NULL DEFAULT true) means a follow-up is still owed.
-- =============================================================================

create table if not exists public.leads (
  id                          uuid primary key default gen_random_uuid(),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  org_slug                    text references public.organisations (slug) on update cascade on delete cascade,
  external_id                 text,
  name                        text,
  interest                    text,
  summary                     text,
  lead_intent                 public.intent_type,
  visit_date_time             timestamptz,
  customer_status             text,
  phone                       text,
  wants_to_connect_on_watsapp boolean,
  pending_action              boolean not null default true,
  source                      public.lead_source,
  status                      public.lead_status not null default 'new',
  notes                       text,
  city                        text,
  pincode                     text,
  actionable                  text check (actionable is null or char_length(actionable) between 1 and 1000),
  recording_url               text check (recording_url is null or char_length(recording_url) between 1 and 2000)
);

-- Webhook idempotency. NULL external_ids coexist (default Postgres behaviour).
create unique index if not exists leads_org_external_idx
  on public.leads (org_slug, external_id);

create index if not exists leads_org_slug_phone_idx
  on public.leads (org_slug, phone) where phone is not null;
create index if not exists leads_org_slug_created_at_idx
  on public.leads (org_slug, created_at desc);
create index if not exists leads_org_status_idx
  on public.leads (org_slug, status);
create index if not exists leads_org_source_idx
  on public.leads (org_slug, source);
-- Expression index for normalized-phone joins (used by lead_call_activity).
create index if not exists leads_phone_norm_idx
  on public.leads (
    org_slug,
    regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')
  );

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

alter table public.leads enable row level security;

drop policy if exists "leads_select_own_org" on public.leads;
create policy "leads_select_own_org"
  on public.leads for select
  to authenticated
  using (
    org_slug in (
      select slug from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "leads_insert_own_org" on public.leads;
create policy "leads_insert_own_org"
  on public.leads for insert
  to authenticated
  with check (
    org_slug in (
      select slug from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "leads_update_own_org" on public.leads;
create policy "leads_update_own_org"
  on public.leads for update
  to authenticated
  using (
    org_slug in (
      select slug from public.organisations where owner_id = (select auth.uid())
    )
  )
  with check (
    org_slug in (
      select slug from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "leads_delete_own_org" on public.leads;
create policy "leads_delete_own_org"
  on public.leads for delete
  to authenticated
  using (
    org_slug in (
      select slug from public.organisations where owner_id = (select auth.uid())
    )
  );

-- =============================================================================
-- reminders — per-org follow-ups, optionally linked to a lead.
-- =============================================================================

create table if not exists public.reminders (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  lead_id          uuid references public.leads (id) on delete set null,
  created_by       uuid references auth.users (id) on delete set null,
  title            text not null check (char_length(title) between 1 and 200),
  notes            text,
  remind_at        timestamptz not null,
  type             text not null default 'other'
                   check (type in ('call', 'whatsapp', 'email', 'visit', 'other')),
  status           text not null default 'pending'
                   check (status in ('pending', 'done', 'dismissed')),
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists reminders_org_remind_at_idx
  on public.reminders (organisation_id, remind_at);
create index if not exists reminders_org_status_idx
  on public.reminders (organisation_id, status);
create index if not exists reminders_lead_idx
  on public.reminders (lead_id) where lead_id is not null;

drop trigger if exists reminders_set_updated_at on public.reminders;
create trigger reminders_set_updated_at
  before update on public.reminders
  for each row execute function public.set_updated_at();

alter table public.reminders enable row level security;

drop policy if exists "reminders_select_own_org" on public.reminders;
create policy "reminders_select_own_org"
  on public.reminders for select
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "reminders_insert_own_org" on public.reminders;
create policy "reminders_insert_own_org"
  on public.reminders for insert
  to authenticated
  with check (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "reminders_update_own_org" on public.reminders;
create policy "reminders_update_own_org"
  on public.reminders for update
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

drop policy if exists "reminders_delete_own_org" on public.reminders;
create policy "reminders_delete_own_org"
  on public.reminders for delete
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

-- =============================================================================
-- bolna_integrations — per-org voice agent config.
--   RLS is enabled with NO authenticated policies — all access goes via the
--   service-role admin client, gated by app-layer userOwnsOrg(). Keeps the
--   api_key off the wire to the browser.
-- =============================================================================

create table if not exists public.bolna_integrations (
  organisation_id    uuid primary key references public.organisations (id) on delete cascade,
  agent_id           text not null check (char_length(agent_id) between 1 and 200),
  api_key            text not null check (char_length(api_key) between 1 and 500),
  from_phone_number  text check (from_phone_number is null or char_length(from_phone_number) between 5 and 32),
  enabled            boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

drop trigger if exists bolna_integrations_set_updated_at on public.bolna_integrations;
create trigger bolna_integrations_set_updated_at
  before update on public.bolna_integrations
  for each row execute function public.set_updated_at();

alter table public.bolna_integrations enable row level security;
-- Intentionally NO policies for authenticated users. Service-role only.

-- =============================================================================
-- calls — outbound + inbound history.
--   Idempotency: full unique constraint on (organisation_id, bolna_call_id).
--   PostgreSQL treats nulls as distinct, so failed-pre-dispatch rows coexist.
-- =============================================================================

create table if not exists public.calls (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete cascade,
  lead_id            uuid references public.leads (id) on delete set null,
  initiated_by       uuid references auth.users (id) on delete set null,
  bolna_call_id      text,
  to_phone           text check (to_phone is null or char_length(to_phone) between 5 and 32),
  from_phone         text,
  agent_id           text not null,
  status             text not null default 'initiated'
                     check (status in ('initiated','ringing','in_progress','completed','failed','no_answer','busy','canceled')),
  direction          public.call_direction not null default 'outbound',
  transcript         text,
  transcript_status  public.call_transcript_status not null default 'pending',
  transcript_fetched_at timestamptz,
  language           text,
  error_code         text,
  error_message      text,
  started_at         timestamptz not null default now(),
  answered_at        timestamptz,
  ended_at           timestamptz,
  duration_seconds   integer check (duration_seconds is null or duration_seconds >= 0),
  recording_url      text,
  transcript_url     text,
  summary            text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint calls_org_bolna_call_id_key unique (organisation_id, bolna_call_id)
);

create index if not exists calls_org_started_at_idx
  on public.calls (organisation_id, started_at desc);
create index if not exists calls_lead_idx
  on public.calls (lead_id) where lead_id is not null;
create index if not exists calls_lead_direction_idx
  on public.calls (lead_id, direction, started_at desc);
-- Expression index used by lead_call_activity for normalized-phone matching.
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

drop trigger if exists calls_set_updated_at on public.calls;
create trigger calls_set_updated_at
  before update on public.calls
  for each row execute function public.set_updated_at();

alter table public.calls enable row level security;

drop policy if exists "calls_select_own_org" on public.calls;
create policy "calls_select_own_org"
  on public.calls for select
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "calls_insert_own_org" on public.calls;
create policy "calls_insert_own_org"
  on public.calls for insert
  to authenticated
  with check (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "calls_update_own_org" on public.calls;
create policy "calls_update_own_org"
  on public.calls for update
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

drop policy if exists "calls_delete_own_org" on public.calls;
create policy "calls_delete_own_org"
  on public.calls for delete
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

-- =============================================================================
-- call_transcripts — one row per utterance. Parsed from calls.transcript.
--   FTS GIN index on `simple` tokenisation safe for mixed Hindi/English.
-- =============================================================================

create table if not exists public.call_transcripts (
  id              uuid primary key default gen_random_uuid(),
  call_id         uuid not null references public.calls (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  seq             integer not null check (seq >= 0),
  speaker         public.call_turn_speaker not null,
  text            text not null,
  started_ms      integer check (started_ms is null or started_ms >= 0),
  ended_ms        integer check (ended_ms is null or ended_ms >= 0),
  confidence      numeric(4, 3)
                  check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at      timestamptz not null default now(),
  unique (call_id, seq)
);

create index if not exists call_transcripts_call_idx
  on public.call_transcripts (call_id, seq);
create index if not exists call_transcripts_org_idx
  on public.call_transcripts (organisation_id);
create index if not exists call_transcripts_text_fts_idx
  on public.call_transcripts using gin (to_tsvector('simple', text));

alter table public.call_transcripts enable row level security;

drop policy if exists "call_transcripts_select_own_org" on public.call_transcripts;
create policy "call_transcripts_select_own_org"
  on public.call_transcripts for select
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "call_transcripts_insert_own_org" on public.call_transcripts;
create policy "call_transcripts_insert_own_org"
  on public.call_transcripts for insert
  to authenticated
  with check (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "call_transcripts_delete_own_org" on public.call_transcripts;
create policy "call_transcripts_delete_own_org"
  on public.call_transcripts for delete
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

-- =============================================================================
-- profiles — one row per auth.users id; holds platform-admin flag.
--   Auto-provisioned on signup via on_auth_user_created.
--   `is_admin` cannot be self-set: WITH CHECK locks it to the stored value.
--   Bootstrapping the first admin still needs a manual UPDATE via service-role.
-- =============================================================================

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: any pre-existing user gets a profile row (safe no-op for fresh DB).
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;

drop policy if exists "profiles_read_self" on public.profiles;
create policy "profiles_read_self"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and is_admin = (
      select is_admin from public.profiles where id = (select auth.uid())
    )
  );

-- =============================================================================
-- RPCs powering the /leads page.
--
--   lead_call_activity(orgId, orgSlug, includeZero, limit, offset) — returns
--     one row per unique normalized phone in the org, with the canonical
--     lead row + aggregated call counts/durations.
--
--   lead_call_activity_count(...) — distinct-phone count companion for the
--     sidebar badge and pagination total.
--
--   Both are SECURITY INVOKER so RLS on `leads` and `calls` continues to
--   gate cross-tenant reads — the Server Action verifies ownership before
--   invoking them.
-- =============================================================================

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
  limit p_limit
  offset p_offset;
$$;

grant execute on function public.lead_call_activity(uuid, text, boolean, int, int)
  to authenticated;

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
  with call_phones as (
    select distinct
      regexp_replace(
        coalesce(
          case when direction = 'inbound' then from_phone else to_phone end,
          ''
        ),
        '[^0-9]', '', 'g'
      ) as phone_norm
    from public.calls
    where organisation_id = p_org_id
  ),
  lead_phones as (
    select distinct
      regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g') as phone_norm
    from public.leads l
    where l.org_slug = p_org_slug
      and l.phone is not null
      and l.phone <> ''
  )
  select count(*)::bigint
  from lead_phones lp
  where lp.phone_norm <> ''
    and (
      p_include_zero_calls
      or lp.phone_norm in (
        select phone_norm from call_phones where phone_norm <> ''
      )
    );
$$;

grant execute on function public.lead_call_activity_count(uuid, text, boolean)
  to authenticated;
