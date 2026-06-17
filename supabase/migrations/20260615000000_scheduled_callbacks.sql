-- Scheduled callbacks: automated outbound call-backs triggered by an INBOUND
-- call whose disposition (call_outcome) maps to the `callback` action in the
-- org's outcome policy.
--
-- This is the standalone analog of a campaign callback. A campaign callback is
-- just a state of a campaign_contact (it has a home); an inbound callback has
-- no batch to belong to, so it gets its own row here. The dial machinery is
-- shared at the function level (initiateBolnaCall + the decision helpers); the
-- STORAGE is deliberately separate (one table = one responsibility):
--   campaign_contacts     — a contact in a batch and its full dial journey
--   scheduled_callbacks   — a one-shot deferred dial not owned by a batch
--
-- v1 scope (per product decision):
--   - Trigger: AUTOMATIC only — inbound outcome === 'callback'. No manual UI.
--   - Agent:   org-default callback agent (bolna_integrations.callback_agent_id,
--              falling back to the integration's default agent_id).
--   - Dedupe:  one callback per source inbound call (unique on source_call_id).
--   - Opt-in:  bolna_integrations.callbacks_enabled gates the whole feature per
--              org, so existing orgs see no behaviour change until they flip it.

-- -----------------------------------------------------------------------------
-- bolna_integrations — org-level callback config (WHO calls back + the flag).
--   WHEN a callback fires already lives in org_outcome_policies (action =
--   'callback'); these columns only answer "is it on, and from which agent".
-- -----------------------------------------------------------------------------

alter table public.bolna_integrations
  add column if not exists callbacks_enabled boolean not null default false,
  add column if not exists callback_agent_id text
    check (callback_agent_id is null or char_length(callback_agent_id) between 1 and 200),
  add column if not exists callback_from_phone text
    check (callback_from_phone is null or char_length(callback_from_phone) between 5 and 32);

-- -----------------------------------------------------------------------------
-- scheduled_callbacks
-- -----------------------------------------------------------------------------

create table if not exists public.scheduled_callbacks (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  lead_id           uuid references public.leads (id) on delete set null,
  -- The inbound call that triggered this callback. Doubles as the idempotency
  -- key (a 3x webhook retry must not queue three callbacks).
  source_call_id    uuid references public.calls (id) on delete set null,

  phone             text not null check (char_length(phone) between 5 and 32),
  phone_normalized  text generated always as (
                      regexp_replace(phone, '[^0-9]', '', 'g')
                    ) stored,

  -- WHO calls back. Resolved at schedule time from the org's callback config;
  -- stored on the row so a later config change can't redirect an in-flight
  -- callback. Validated against the voice_agents registry at schedule time.
  agent_id          text not null check (char_length(agent_id) between 1 and 200),
  -- Caller-ID override; null → the integration default at dial time.
  from_phone        text check (from_phone is null or char_length(from_phone) between 5 and 32),

  status            text not null default 'pending'
                      check (status in ('pending','in_flight','succeeded','failed','canceled')),
  scheduled_at      timestamptz not null,   -- the customer's requested time
  next_attempt_at   timestamptz not null,   -- drives the drainer (= scheduled_at initially)
  attempt           smallint not null default 0,
  max_attempts      smallint not null default 3 check (max_attempts between 1 and 10),
  retry_interval_seconds integer not null default 900
                      check (retry_interval_seconds between 60 and 86400),

  last_call_id      uuid references public.calls (id) on delete set null,
  last_status       text,
  last_outcome      text,
  last_error        text,

  -- Forward-compat: v1 only ever writes 'inbound_outcome'. A future manual
  -- "Schedule callback" button would write 'manual'.
  origin            text not null default 'inbound_outcome'
                      check (origin in ('inbound_outcome','manual')),
  created_by        uuid references auth.users (id) on delete set null,  -- null = system
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Drainer hot path: due pending callbacks, oldest first.
create index if not exists scheduled_callbacks_due_idx
  on public.scheduled_callbacks (next_attempt_at) where status = 'pending';
create index if not exists scheduled_callbacks_org_idx
  on public.scheduled_callbacks (organisation_id, created_at desc);
create index if not exists scheduled_callbacks_lead_idx
  on public.scheduled_callbacks (lead_id) where lead_id is not null;

-- IDEMPOTENCY + dedupe: at most one callback per triggering inbound call, so
-- the 3x post-call webhook retries collapse to a single queued callback.
create unique index if not exists scheduled_callbacks_one_per_source
  on public.scheduled_callbacks (source_call_id) where source_call_id is not null;

drop trigger if exists scheduled_callbacks_set_updated_at on public.scheduled_callbacks;
create trigger scheduled_callbacks_set_updated_at
  before update on public.scheduled_callbacks
  for each row execute function public.set_updated_at();

alter table public.scheduled_callbacks enable row level security;

-- Read-only for org owners (so a future UI can list/inspect). All WRITES go
-- through the service-role admin client (webhook scheduler + cron drainer),
-- gated server-side — same posture as voice_agents.
drop policy if exists "scheduled_callbacks_select_own_org" on public.scheduled_callbacks;
create policy "scheduled_callbacks_select_own_org"
  on public.scheduled_callbacks for select
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

-- -----------------------------------------------------------------------------
-- calls.scheduled_callback_id — the seam between the dial pipeline and a
-- scheduled callback (mirrors calls.campaign_contact_id). The outbound webhook
-- reads it to advance the callback's state machine.
-- -----------------------------------------------------------------------------

alter table public.calls
  add column if not exists scheduled_callback_id uuid
    references public.scheduled_callbacks (id) on delete set null;

create index if not exists calls_scheduled_callback_idx
  on public.calls (scheduled_callback_id) where scheduled_callback_id is not null;

-- -----------------------------------------------------------------------------
-- Realtime publication (so a future UI can live-update). Wrapped so re-runs
-- and already-published tables don't error.
-- -----------------------------------------------------------------------------

do $$
begin
  begin
    alter publication supabase_realtime add table public.scheduled_callbacks;
  exception when duplicate_object then null;
  end;
end $$;
