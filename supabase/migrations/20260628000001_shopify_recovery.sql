-- =============================================================================
-- Cart Recovery engine — per-org settings + the recovery-attempt queue.
--   Mirrors the scheduled_callbacks design: a queue table drained by the shared
--   cron tick with an optimistic CAS claim, plus calls.shopify_recovery_attempt_id
--   as the seam back from the dial pipeline. Settings/attempts are owner-readable
--   (the org dashboard + settings page); all writes go via the service-role
--   client in server actions / the webhook, after ownership checks.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- shopify_recovery_settings — the org's tunable levers (hybrid: admin connects
-- the store, the org tunes offer + timing). One row per org.
-- -----------------------------------------------------------------------------
create table if not exists public.shopify_recovery_settings (
  organisation_id        uuid primary key references public.organisations (id) on delete cascade,
  enabled                boolean not null default false,
  -- Wait before the first recovery call (gives the shopper time to return).
  wait_minutes           integer not null default 45 check (wait_minutes between 1 and 1440),
  max_attempts           smallint not null default 2 check (max_attempts between 1 and 10),
  retry_interval_seconds integer not null default 1800 check (retry_interval_seconds between 60 and 86400),
  -- Voice agent override; null → fall back to the org's default agent.
  agent_id               text check (agent_id is null or char_length(agent_id) between 1 and 200),
  -- The incentive the agent offers on the call.
  offer_type             text not null default 'none'
                           check (offer_type in ('none','discount_code','free_product')),
  offer_code             text check (offer_code is null or char_length(offer_code) <= 120),
  offer_label            text check (offer_label is null or char_length(offer_label) <= 200),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

drop trigger if exists shopify_recovery_settings_set_updated_at on public.shopify_recovery_settings;
create trigger shopify_recovery_settings_set_updated_at
  before update on public.shopify_recovery_settings
  for each row execute function public.set_updated_at();

alter table public.shopify_recovery_settings enable row level security;

drop policy if exists "shopify_recovery_settings_select_own_org" on public.shopify_recovery_settings;
create policy "shopify_recovery_settings_select_own_org"
  on public.shopify_recovery_settings for select
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

-- -----------------------------------------------------------------------------
-- shopify_recovery_attempts — one row per abandoned checkout we act on. The
-- (organisation_id, checkout_token) unique key makes webhook retries idempotent
-- and guarantees one recovery per cart.
-- -----------------------------------------------------------------------------
create table if not exists public.shopify_recovery_attempts (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete cascade,
  shop_domain            text not null,
  checkout_token         text not null,
  lead_id                uuid references public.leads (id) on delete set null,
  status                 text not null default 'pending'
                           check (status in ('pending','in_flight','succeeded','failed','canceled','skipped')),
  -- Why a checkout was never called (no_phone / no_consent / no_voice_agent).
  skip_reason            text,
  phone                  text,
  customer_name          text,
  agent_id               text,
  from_phone             text,
  attempt                smallint not null default 0,
  max_attempts           smallint not null default 2,
  retry_interval_seconds integer not null default 1800,
  scheduled_at           timestamptz not null default now(),
  next_attempt_at        timestamptz not null default now(),
  last_call_id           uuid references public.calls (id) on delete set null,
  last_status            text,
  last_error             text,
  -- Cart context, snapshotted so the agent can talk about it on the call.
  cart_total             numeric(12,2),
  currency               text,
  recovery_url           text,
  cart_items             jsonb not null default '[]'::jsonb,
  -- Offer snapshot (taken when the attempt is scheduled).
  offer_label            text,
  offer_code             text,
  -- Set when the shopper completes the order (recovered).
  converted_at           timestamptz,
  canceled_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (organisation_id, checkout_token)
);

drop trigger if exists shopify_recovery_attempts_set_updated_at on public.shopify_recovery_attempts;
create trigger shopify_recovery_attempts_set_updated_at
  before update on public.shopify_recovery_attempts
  for each row execute function public.set_updated_at();

-- Drainer query: due pending rows, oldest first.
create index if not exists shopify_recovery_attempts_due_idx
  on public.shopify_recovery_attempts (next_attempt_at)
  where status = 'pending';

-- Dashboard / activity feed, newest first per org.
create index if not exists shopify_recovery_attempts_org_idx
  on public.shopify_recovery_attempts (organisation_id, created_at desc);

alter table public.shopify_recovery_attempts enable row level security;

drop policy if exists "shopify_recovery_attempts_select_own_org" on public.shopify_recovery_attempts;
create policy "shopify_recovery_attempts_select_own_org"
  on public.shopify_recovery_attempts for select
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

-- -----------------------------------------------------------------------------
-- calls.shopify_recovery_attempt_id — the seam between the dial pipeline and a
-- recovery attempt (mirrors calls.scheduled_callback_id). Lets the call-result
-- path advance the recovery state machine.
-- -----------------------------------------------------------------------------
alter table public.calls
  add column if not exists shopify_recovery_attempt_id uuid;

create index if not exists calls_shopify_recovery_attempt_idx
  on public.calls (shopify_recovery_attempt_id)
  where shopify_recovery_attempt_id is not null;
