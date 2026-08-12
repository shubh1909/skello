-- =============================================================================
-- Lead intake — the shared spine for every non-voice lead source.
--
-- WHY THIS EXISTS
--
-- Google Ads lead forms, Click-to-WhatsApp ads and 99acres all do the same five
-- things: receive a POST, resolve the tenant, verify, normalise, ingest. Only
-- normalisation differs. Three bespoke integrations would mean three tenancy
-- resolutions, three idempotency schemes and three "did it work?" surfaces —
-- and the one that gets least traffic is the one that rots.
--
-- So: one config table, one event ledger, one ingest path. A new channel is a
-- normaliser plus a route, not a schema change.
--
-- The voice-agent path (calls → mergePayloadIntoLead) is untouched. It has its
-- own webhook contract and its own per-call snapshot on `calls`; folding it in
-- here would mean bending the richest source to fit the simplest ones.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- lead_intake_sources — per-org, per-channel connection config.
--
-- Holds secrets (Google's key, a portal api_key, a Meta app secret), so RLS is
-- enabled with NO authenticated policies: service-role only, reached through
-- Server Actions that check org ownership themselves and return a REDACTED
-- view. Same shape as whatsapp_integrations / bolna_integrations.
-- -----------------------------------------------------------------------------
create table if not exists public.lead_intake_sources (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,

  -- Kept as a CHECK, not an enum: adding a channel should be one migration line
  -- that can run inside a transaction alongside its backfill. ADD VALUE cannot.
  channel           text not null
                      check (channel in ('google_ads', 'whatsapp', 'portal_99acres')),

  -- Human label. A builder may run two Google accounts for two projects, and
  -- "which of these two URLs did I paste into which campaign" is otherwise
  -- unanswerable.
  name              text check (name is null or char_length(name) between 1 and 80),

  -- The unguessable segment in the webhook URL. 32 random bytes, base64url,
  -- generated server-side and never user-chosen.
  --
  -- On channels with no signature at all (99acres) this token IS the security
  -- boundary, so it is globally unique and rotatable. On Google it also stops a
  -- leaked google_key from being usable against a tenant the attacker picks.
  public_token      text not null unique
                      check (char_length(public_token) between 20 and 128),

  -- Channel-specific credentials, unshaped on purpose: google_key for Google;
  -- app_secret / access_token / phone_number_id / waba_id / verify_token for
  -- WhatsApp; api_key for a portal. A column per channel would be four columns
  -- null on every row.
  credentials       jsonb not null default '{}'::jsonb,

  -- Payload key → Skelo field. Defaults live in code (Google's column_id set is
  -- a fixed enum, so code is the right home). This overrides them per account,
  -- which is what 99acres needs — its field names vary per seller.
  field_map         jsonb not null default '{}'::jsonb,

  enabled           boolean not null default true,

  -- Denormalised from lead_intake_events. A push integration's only honest
  -- health signal is "when did something last arrive", and the UI must not run
  -- an aggregate over the whole ledger to answer it.
  last_event_at     timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists lead_intake_sources_org_channel_idx
  on public.lead_intake_sources (organisation_id, channel);

drop trigger if exists lead_intake_sources_set_updated_at on public.lead_intake_sources;
create trigger lead_intake_sources_set_updated_at
  before update on public.lead_intake_sources
  for each row execute function public.set_updated_at();

alter table public.lead_intake_sources enable row level security;
-- No authenticated policies — service-role only (this table holds secrets).

comment on table public.lead_intake_sources is
  'Per-org webhook endpoints for non-voice lead sources. Holds credentials; '
  'service-role only, read through a redacting Server Action.';

-- -----------------------------------------------------------------------------
-- lead_intake_events — one row per delivery, written BEFORE the ack.
--
-- Three jobs, which is why it is worth a table rather than a log line:
--
--   1. Idempotency. Google says outright that a lead_id may be delivered more
--      than once; Meta redelivers. The unique index below is the gate.
--   2. The customer-facing delivery log. "Did my form work?" is the whole
--      question during onboarding, and a timestamp answers it.
--   3. Replay. 99acres publishes no schema, so the first live enquiry IS the
--      spec. Storing the raw body means a wrong field map costs a re-run, not
--      a week of lost leads.
-- -----------------------------------------------------------------------------
create table if not exists public.lead_intake_events (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  source_id         uuid not null references public.lead_intake_sources (id) on delete cascade,
  -- Denormalised from the source so the ledger stays readable after a source is
  -- reconfigured, and so the UI can filter without a join.
  channel           text not null,

  -- Google lead_id / WhatsApp wamid / portal enquiry id. Null when the channel
  -- gives us nothing stable to key on — then dedupe degrades to accept-once,
  -- which is why the unique index below is partial.
  external_id       text check (external_id is null or char_length(external_id) <= 200),

  status            text not null default 'received' check (
    status in ('received', 'processed', 'duplicate', 'test', 'ignored', 'failed')
  ),

  -- Set once ingest succeeds. ON DELETE SET NULL, not CASCADE: deleting a lead
  -- must not erase the evidence that it arrived.
  lead_id           uuid references public.leads (id) on delete set null,

  payload           jsonb not null,
  error             text,

  received_at       timestamptz not null default now(),
  processed_at      timestamptz
);

-- The idempotency gate. Partial so a null external_id never collides with
-- another null — in Postgres nulls are distinct in a unique index anyway, but
-- stating it keeps the intent legible and keeps the index small.
create unique index if not exists lead_intake_events_dedupe_idx
  on public.lead_intake_events (source_id, external_id)
  where external_id is not null;

-- The delivery log's own read pattern: newest first, per org.
create index if not exists lead_intake_events_org_received_idx
  on public.lead_intake_events (organisation_id, received_at desc);

create index if not exists lead_intake_events_source_received_idx
  on public.lead_intake_events (source_id, received_at desc);

alter table public.lead_intake_events enable row level security;

-- Unlike the sources table, this one IS read by ordinary authenticated users:
-- the delivery log is the entire point of the Integrations tab. Payloads carry
-- a name and a phone — data the customer already owns — and nothing else.
--
-- Tenancy is single-owner (organisations.owner_id); there is no membership
-- table in this codebase. `(select auth.uid())` wrapped for planner caching,
-- matching every other policy here.
drop policy if exists "lead_intake_events_select_own_org" on public.lead_intake_events;
create policy "lead_intake_events_select_own_org"
  on public.lead_intake_events for select
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );
-- Writes are webhook-side only, on the service-role client. No write policy.

comment on table public.lead_intake_events is
  'One row per inbound delivery from a lead_intake_source. Written before the '
  'webhook acks: it is the idempotency key, the customer-facing delivery log '
  'and the replay buffer.';
