-- =============================================================================
-- Cart Recovery — WhatsApp as a second outbound channel.
--
-- WhatsApp lives on the SAME shopify_recovery_attempts row as the voice call (a
-- parallel "WhatsApp track"), driven by its own drainer on the shared cron tick.
-- The voice state machine is untouched; defaults keep every existing org
-- voice-only until they opt in (whatsapp_enabled = false).
--
-- Provider-agnostic by design: the sender/webhook are the only provider-specific
-- seams. A `provider` column (default 'kwikengage') lets a different org use a
-- different WhatsApp BSP later without a schema change — the dispatcher/ledger/
-- UI stay the same.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- whatsapp_integrations — per-org BSP config (mirrors bolna_integrations).
-- RLS enabled with NO authenticated policies: reads/writes go through the
-- service-role admin client after an ownership check in the server action.
-- -----------------------------------------------------------------------------
create table if not exists public.whatsapp_integrations (
  organisation_id  uuid primary key references public.organisations (id) on delete cascade,
  -- Which BSP powers this org's WhatsApp. Only 'kwikengage' is wired today; the
  -- column exists so adding another BSP is an adapter + webhook route, not a
  -- migration.
  provider         text not null default 'kwikengage'
                     check (char_length(provider) between 1 and 40),
  api_token        text not null check (char_length(api_token) between 1 and 500),
  -- Optional endpoint override; null → the provider client's env/default base.
  base_url         text check (base_url is null or char_length(base_url) between 1 and 300),
  -- The WhatsApp sender (phone-number-id / sender number) shown to shoppers.
  sender_id        text check (sender_id is null or char_length(sender_id) between 1 and 64),
  -- Default Meta-approved template for abandoned-cart sends. Null → not ready to
  -- send (the WhatsApp track is skipped with reason 'no_template').
  template_name    text check (template_name is null or char_length(template_name) between 1 and 200),
  -- Provider-specific extras (waba_id, app_id, namespace, …) without new columns.
  config           jsonb not null default '{}'::jsonb,
  enabled          boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

drop trigger if exists whatsapp_integrations_set_updated_at on public.whatsapp_integrations;
create trigger whatsapp_integrations_set_updated_at
  before update on public.whatsapp_integrations
  for each row execute function public.set_updated_at();

alter table public.whatsapp_integrations enable row level security;
-- No authenticated policies — service-role only.

-- -----------------------------------------------------------------------------
-- shopify_recovery_settings — channel levers. Defaults reproduce today's
-- voice-only behaviour exactly (whatsapp_enabled = false, voice_enabled = true).
-- -----------------------------------------------------------------------------
alter table public.shopify_recovery_settings
  add column if not exists voice_enabled boolean not null default true,
  add column if not exists whatsapp_enabled boolean not null default false,
  -- Which channel goes first; the other escalates after escalation_gap_minutes
  -- only if the cart hasn't converted.
  add column if not exists first_channel text not null default 'whatsapp'
    check (first_channel in ('whatsapp', 'voice')),
  add column if not exists escalation_gap_minutes integer not null default 30
    check (escalation_gap_minutes between 1 and 10080),
  -- Optional per-org template override; null → the integration's template_name.
  add column if not exists whatsapp_template_name text
    check (whatsapp_template_name is null or char_length(whatsapp_template_name) <= 200);

-- -----------------------------------------------------------------------------
-- shopify_recovery_messages — one row per WhatsApp send (parallel to how `calls`
-- logs voice). A dedicated ledger, NOT a column on `calls`: WhatsApp has a
-- different lifecycle + identifiers, and overloading `calls` would force most
-- columns nullable and poison its (org, bolna_call_id) idempotency key.
-- -----------------------------------------------------------------------------
create table if not exists public.shopify_recovery_messages (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references public.organisations (id) on delete cascade,
  -- Seam back to the attempt (no FK, mirrors calls.shopify_recovery_attempt_id).
  shopify_recovery_attempt_id uuid,
  to_phone                    text,
  template_name               text,
  provider                    text not null default 'kwikengage',
  -- The BSP's message id — the correlation key for delivery webhooks.
  provider_message_id         text,
  status                      text not null default 'queued'
                                check (status in ('queued','sent','delivered','read','failed')),
  error_message               text,
  sent_at                     timestamptz,
  delivered_at                timestamptz,
  read_at                     timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

drop trigger if exists shopify_recovery_messages_set_updated_at on public.shopify_recovery_messages;
create trigger shopify_recovery_messages_set_updated_at
  before update on public.shopify_recovery_messages
  for each row execute function public.set_updated_at();

-- Idempotent webhook correlation. Partial + nulls-distinct so many rows can sit
-- at NULL before the provider returns an id (like calls.bolna_call_id).
create unique index if not exists shopify_recovery_messages_provider_msg_idx
  on public.shopify_recovery_messages (organisation_id, provider_message_id)
  where provider_message_id is not null;

create index if not exists shopify_recovery_messages_attempt_idx
  on public.shopify_recovery_messages (shopify_recovery_attempt_id)
  where shopify_recovery_attempt_id is not null;

create index if not exists shopify_recovery_messages_org_idx
  on public.shopify_recovery_messages (organisation_id, created_at desc);

alter table public.shopify_recovery_messages enable row level security;

drop policy if exists "shopify_recovery_messages_select_own_org" on public.shopify_recovery_messages;
create policy "shopify_recovery_messages_select_own_org"
  on public.shopify_recovery_messages for select
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

-- -----------------------------------------------------------------------------
-- shopify_recovery_attempts — the parallel WhatsApp track. Terminal state is
-- 'sent' (delivered/read live on the message ledger, not the attempt). Legacy
-- rows sit at 'none' with a null next_at and are invisible to the new drainer.
-- -----------------------------------------------------------------------------
alter table public.shopify_recovery_attempts
  add column if not exists whatsapp_status text not null default 'none'
    check (whatsapp_status in ('none','pending','in_flight','sent','failed','skipped','canceled')),
  add column if not exists whatsapp_attempt smallint not null default 0,
  -- A template is one-shot; retries only cover transient send failures.
  add column if not exists whatsapp_max_attempts smallint not null default 1,
  add column if not exists whatsapp_next_at timestamptz,
  add column if not exists whatsapp_sent_at timestamptz,
  add column if not exists whatsapp_skip_reason text,
  add column if not exists last_whatsapp_message_id uuid
    references public.shopify_recovery_messages (id) on delete set null,
  add column if not exists whatsapp_error text;

-- Drainer query: due pending WhatsApp sends, oldest first.
create index if not exists shopify_recovery_attempts_wa_due_idx
  on public.shopify_recovery_attempts (whatsapp_next_at)
  where whatsapp_status = 'pending';
