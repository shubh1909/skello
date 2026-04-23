-- Per-org Bolna outbound agent configuration + call history.
--
-- bolna_integrations:
--   One row per organisation. Stores the org's Bolna API key and outbound
--   agent id. RLS is enabled with NO policies for authenticated users — the
--   table is invisible to the user-session Supabase client. Server Actions
--   reach it via the service-role admin client and gate access via
--   userOwnsOrg(). This keeps the api_key off the wire to the browser.
--
-- calls:
--   Outbound call records. Tenant-scoped. Receives status updates from the
--   /api/webhooks/bolna/calls handler (admin client, signature-checked).
--   Idempotency key: (organisation_id, bolna_call_id).

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
-- Intentionally NO policies for authenticated users: all access goes through
-- the service-role admin client, gated by app-layer userOwnsOrg().

-- -----------------------------------------------------------------------------

create table if not exists public.calls (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete cascade,
  lead_id            uuid references public.leads (id) on delete set null,
  initiated_by       uuid references auth.users (id) on delete set null,
  bolna_call_id      text,
  to_phone           text not null check (char_length(to_phone) between 5 and 32),
  from_phone         text,
  agent_id           text not null,
  status             text not null default 'initiated'
                     check (status in ('initiated','ringing','in_progress','completed','failed','no_answer','busy','canceled')),
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
  updated_at         timestamptz not null default now()
);

create unique index if not exists calls_org_bolna_call_id_key
  on public.calls (organisation_id, bolna_call_id) where bolna_call_id is not null;
create index if not exists calls_org_started_at_idx
  on public.calls (organisation_id, started_at desc);
create index if not exists calls_lead_idx
  on public.calls (lead_id) where lead_id is not null;

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
