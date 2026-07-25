-- =============================================================================
-- COD (Cash-on-Delivery) order confirmation — a SEPARATE section from cart
-- recovery. When a shopper places a COD order, the voice agent calls them to
-- reconfirm the order + payment method. The agent extracts a `confirmed` field
-- (yes/no) we store verbatim; the call is RE-DIALLED only when it did not
-- connect (capped by max_attempts). It reuses the shared dial primitives and the
-- cron tick, but has its OWN settings + queue table — none of cart recovery's
-- offer / conversion / WhatsApp machinery applies here.
--
-- Mirrors shopify_recovery_* structurally: a queue table drained by the cron
-- tick with an optimistic CAS claim, plus calls.cod_confirmation_id as the seam
-- back from the dial pipeline. Owner-readable; all writes via the service-role
-- client (webhook, cron, server actions after an ownership check).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- shopify_cod_settings — the org's tunable levers for COD confirmation. One row
-- per org (upsert on the PK).
-- -----------------------------------------------------------------------------
create table if not exists public.shopify_cod_settings (
  organisation_id        uuid primary key references public.organisations (id) on delete cascade,
  enabled                boolean not null default false,
  -- Wait after the order is placed before the first confirmation call.
  wait_minutes           integer not null default 15 check (wait_minutes between 1 and 1440),
  max_attempts           smallint not null default 3 check (max_attempts between 1 and 10),
  retry_interval_seconds integer not null default 1800 check (retry_interval_seconds between 60 and 86400),
  -- Voice agent override; null → fall back to the org's default agent. This is
  -- the COD-confirmation agent (its script asks to reconfirm the order and
  -- extracts the `confirmed` field), distinct from the recovery agent.
  agent_id               text check (agent_id is null or char_length(agent_id) between 1 and 200),
  -- Daily calling window (evaluated in APP_TIMEZONE). Both null → call any time.
  call_window_start      time,
  call_window_end        time,
  -- Gateway-name allowlist used to detect a COD order from the Shopify order
  -- payload. Empty → fall back to a built-in heuristic (matches "cash on
  -- delivery" / the word "cod" in the gateway names). Merchants whose gateway
  -- reports a custom label add it here.
  cod_gateway_names      text[] not null default '{}'::text[],
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

drop trigger if exists shopify_cod_settings_set_updated_at on public.shopify_cod_settings;
create trigger shopify_cod_settings_set_updated_at
  before update on public.shopify_cod_settings
  for each row execute function public.set_updated_at();

alter table public.shopify_cod_settings enable row level security;

drop policy if exists "shopify_cod_settings_select_own_org" on public.shopify_cod_settings;
create policy "shopify_cod_settings_select_own_org"
  on public.shopify_cod_settings for select
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

-- -----------------------------------------------------------------------------
-- shopify_cod_confirmations — one row per COD order we act on. The
-- (organisation_id, order_id) unique key makes webhook redelivery (orders/create
-- followed by orders/updated / orders/paid for the same order) idempotent and
-- guarantees one confirmation flow per order.
-- -----------------------------------------------------------------------------
create table if not exists public.shopify_cod_confirmations (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete cascade,
  shop_domain            text not null,
  order_id               text not null,
  -- Human order name ("#1046") the merchant recognises.
  order_name             text,
  order_total            numeric(12,2),
  currency               text,
  lead_id                uuid references public.leads (id) on delete set null,
  phone                  text,
  customer_name          text,
  -- The gateway string that classified this as COD (kept for display/debug).
  gateway                text,
  -- Dial lifecycle. `confirmed_call` = we reached the customer and recorded a
  -- disposition; the `confirmed` column then carries yes/no. `failed` = never
  -- connected within max_attempts. `skipped` = never actionable (no phone / no
  -- voice agent). `canceled` = the org turned the feature off while queued.
  status                 text not null default 'pending'
                           check (status in ('pending','in_flight','confirmed_call','failed','canceled','skipped')),
  -- The recorded disposition. NULL until a connected call reports it. TRUE = the
  -- customer confirmed the order + COD; FALSE = they declined / were unsure.
  confirmed              boolean,
  -- Why an order was never called (no_phone / no_voice_agent / per_lead_cap_reached).
  skip_reason            text,
  agent_id               text,
  from_phone             text,
  attempt                smallint not null default 0,
  max_attempts           smallint not null default 3,
  retry_interval_seconds integer not null default 1800,
  scheduled_at           timestamptz not null default now(),
  next_attempt_at        timestamptz not null default now(),
  last_call_id           uuid references public.calls (id) on delete set null,
  last_status            text,
  last_error             text,
  -- Stamped when we first reach the customer (a connected call).
  connected_at           timestamptz,
  canceled_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (organisation_id, order_id)
);

drop trigger if exists shopify_cod_confirmations_set_updated_at on public.shopify_cod_confirmations;
create trigger shopify_cod_confirmations_set_updated_at
  before update on public.shopify_cod_confirmations
  for each row execute function public.set_updated_at();

-- Drainer query: due pending rows, oldest first.
create index if not exists shopify_cod_confirmations_due_idx
  on public.shopify_cod_confirmations (next_attempt_at)
  where status = 'pending';

-- Dashboard / activity feed, newest first per org.
create index if not exists shopify_cod_confirmations_org_idx
  on public.shopify_cod_confirmations (organisation_id, created_at desc);

alter table public.shopify_cod_confirmations enable row level security;

drop policy if exists "shopify_cod_confirmations_select_own_org" on public.shopify_cod_confirmations;
create policy "shopify_cod_confirmations_select_own_org"
  on public.shopify_cod_confirmations for select
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

-- -----------------------------------------------------------------------------
-- calls.cod_confirmation_id — the seam between the dial pipeline and a COD
-- confirmation (mirrors calls.shopify_recovery_attempt_id). Lets the call-result
-- path advance the confirmation state machine + record the extracted disposition.
-- -----------------------------------------------------------------------------
alter table public.calls
  add column if not exists cod_confirmation_id uuid;

create index if not exists calls_cod_confirmation_idx
  on public.calls (cod_confirmation_id)
  where cod_confirmation_id is not null;
