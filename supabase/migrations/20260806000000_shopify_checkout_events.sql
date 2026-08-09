-- =============================================================================
-- shopify_checkout_events — the durable receipt log for checkouts/* webhooks.
--
-- WHY THIS EXISTS
--
-- The webhook handler 200s Shopify and then does the real work inside
-- next/after(). That keeps us inside Shopify's ~5s response budget (scheduling a
-- recovery costs 6-8 sequential round trips), but it means the 200 is a promise
-- we have not yet kept: nothing is persisted at the moment we tell Shopify to
-- stop caring. If the handler throws — or the process is replaced mid-callback,
-- which pm2 does with a 1.6s default kill timeout while Next asks for 10-30s —
-- the checkout is gone for good. Shopify will never redeliver it, because we
-- already said "got it".
--
-- On 4 Aug 2026 a cart abandoned at 11:38 first appeared in
-- shopify_recovery_attempts at 07:10 the NEXT morning. It was undiagnosable:
-- nothing recorded a checkout webhook arriving, so "Shopify delivered late" and
-- "we silently dropped it" left identical evidence — none.
--
-- So every checkouts/* delivery is written here FIRST, before the 200, and the
-- cron tick drains whatever is still unprocessed. This is the same pattern
-- shopify_order_events (20260722000000) already applies to orders/*, moved one
-- step earlier: that ledger is written inside after(), so it survives a DB error
-- but not a process kill. This one is written on the request path, so a failure
-- to record means we do NOT ack — and Shopify's retry machinery works for us
-- instead of being defeated by a premature 200.
--
-- It also makes delivery lag measurable for the first time: triggered_at is
-- Shopify's own send time, so received_at - triggered_at settles the "was it
-- them or us" question without guesswork.
--
-- Service-role only: RLS on, no authenticated policies (mirrors
-- shopify_order_events and bolna_integrations). Nothing here is read by a client.
-- =============================================================================

create table if not exists public.shopify_checkout_events (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  shop_domain      text not null,
  topic            text not null,
  -- X-Shopify-Webhook-Id: Shopify's per-EVENT delivery id, reused across its own
  -- retries of that event. The idempotency key — a redelivery inserts nothing.
  -- Nullable defensively; Shopify always sends it, but a missing header must not
  -- cost us the receipt (and NULLs stay distinct under the unique constraint, so
  -- such rows simply never dedupe).
  webhook_id       text,
  -- Shopify's checkout token, denormalised out of the payload so the drainer can
  -- pre-check conversions and humans can join to shopify_recovery_attempts.
  checkout_token   text,
  -- X-Shopify-Triggered-At: when SHOPIFY sent it. received_at - triggered_at is
  -- delivery lag; a large gap here exonerates us, a small one indicts us.
  triggered_at     timestamptz,
  received_at      timestamptz not null default now(),
  -- The verified payload, kept so a replay needs no call back to Shopify.
  -- Contains shopper PII (phone, email, addresses) — drainPendingCheckoutEvents
  -- deletes processed rows after CHECKOUT_EVENT_RETENTION_DAYS.
  payload          jsonb not null,
  -- Null until scheduling succeeded. The cron tick drains rows where this is
  -- still null and attempts is under the ceiling.
  processed_at     timestamptz,
  attempts         smallint not null default 0,
  last_error       text,
  created_at       timestamptz not null default now(),
  -- Plain (not partial) unique so PostgREST's ON CONFLICT inference can name it.
  unique (organisation_id, webhook_id)
);

-- The drain query: unprocessed, oldest first, giving up after a few tries.
create index if not exists shopify_checkout_events_unprocessed_idx
  on public.shopify_checkout_events (received_at)
  where processed_at is null;

-- Debugging + the lag report: "show me every event for this cart".
create index if not exists shopify_checkout_events_org_token_idx
  on public.shopify_checkout_events (organisation_id, checkout_token);

alter table public.shopify_checkout_events enable row level security;

comment on table public.shopify_checkout_events is
  'Durable receipt log of Shopify checkouts/* webhooks. Written BEFORE we ack '
  'Shopify — unlike shopify_order_events, which is written inside next/after() '
  'and so survives a DB error but not a process kill. A failure to record here '
  'must return non-2xx so Shopify retries. The cron tick drains unprocessed '
  'rows. triggered_at (X-Shopify-Triggered-At) minus received_at is delivery '
  'lag. Service-role only.';

comment on column public.shopify_checkout_events.payload is
  'Verified webhook body. Holds shopper PII; processed rows are pruned by the '
  'drainer after a short retention window.';
