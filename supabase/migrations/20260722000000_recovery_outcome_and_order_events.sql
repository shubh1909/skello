-- =============================================================================
-- 20260722000000 — One definition of "recovered", and a durable order ledger.
-- =============================================================================
-- WHY
-- ----
-- The 10-minute abandonment threshold is a SCHEDULING + DISPLAY rule: don't dial
-- inside the window, don't list the cart as abandoned inside the window. That is
-- all it was ever meant to do, and it keeps doing exactly that.
--
-- The 20260720 migration additionally borrowed it to DEFINE a recovery
-- (`is_recovery` = converted more than 10 min after the row was created). That is
-- a different question, and the threshold answers it wrongly: it never asks
-- whether we contacted the shopper. Measured over 1–21 Jul, 28 conversions were
-- reported as recovered; only 7 had any outreach from us before the order — 21%
-- precision. It also breaks on re-checkout: a shopper who abandons, comes back
-- and opens a NEW checkout gets a fresh row, so the order attaches to a young
-- session and is labelled an "instant sale" while the cart we actually worked is
-- left open and uncredited.
--
-- WHAT CHANGES
-- ------------
--   • is_recovery (GENERATED)  ->  DROPPED. It also hardcoded '10 minutes' in SQL,
--     a second source of truth beside ABANDONMENT_THRESHOLD_MINUTES in TS.
--   • recovery_outcome  NEW. Stamped ONCE at conversion time, buyer-scoped:
--       'recovered_by_us'   — we reached this BUYER (call connected or WhatsApp
--                             sent) before the order landed. The ROI number.
--       'recovered_organic' — genuinely abandoned past the window, but came back
--                             on their own. Not ours to claim.
--       'instant_sale'      — bought without ever abandoning. Never ours.
--     Null while a cart is still open.
--   • first_contact_at  NEW. The touch that justifies 'recovered_by_us', so the
--     label is explainable in the UI instead of being re-derived per query.
--   • shopify_order_events  NEW. Orders are settled inside next/after(), i.e.
--     AFTER we have already 200'd Shopify — so a transient failure loses the
--     conversion permanently and Shopify never retries. Every order now lands in
--     a ledger first; the cron tick drains anything left unprocessed.
--
-- This collapses three competing definitions of "recovered" (converted_at
-- non-null / is_recovery / the `attributed` flag computed in the actions layer)
-- into this one column.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Retire the generated column (and its partial index, dropped with it).
-- -----------------------------------------------------------------------------
drop index if exists public.shopify_recovery_attempts_is_recovery_idx;

alter table public.shopify_recovery_attempts
  drop column if exists is_recovery;

-- -----------------------------------------------------------------------------
-- 2) The stamped outcome.
-- -----------------------------------------------------------------------------
alter table public.shopify_recovery_attempts
  add column if not exists recovery_outcome text
    check (
      recovery_outcome is null
      or recovery_outcome in ('recovered_by_us', 'recovered_organic', 'instant_sale')
    );

alter table public.shopify_recovery_attempts
  add column if not exists first_contact_at timestamptz;

comment on column public.shopify_recovery_attempts.recovery_outcome is
  'Stamped once when the order is settled. recovered_by_us = we reached this '
  'buyer (call connected or WhatsApp sent) before the order; recovered_organic = '
  'abandoned past the window but returned unaided; instant_sale = bought without '
  'ever abandoning. Null while open. The single source of truth for recovery '
  'metrics — do NOT re-derive from converted_at timing.';

comment on column public.shopify_recovery_attempts.first_contact_at is
  'Earliest outreach to this BUYER (min of connected_at / whatsapp_sent_at across '
  'their carts) that preceded the order. Non-null exactly when recovery_outcome '
  'is recovered_by_us — it is the evidence for that label.';

-- Feeds the Recovered tab + the recovered/revenue tiles.
create index if not exists shopify_recovery_attempts_outcome_idx
  on public.shopify_recovery_attempts (organisation_id, recovery_outcome)
  where recovery_outcome is not null;

-- The buyer-scoped settlement sweeps by org + phone inside a 3-day window; this
-- covers it for every status (the old partial index only held open rows, so the
-- succeeded/failed carts we most need to credit were never indexed).
create index if not exists shopify_recovery_attempts_org_phone_created_idx
  on public.shopify_recovery_attempts (organisation_id, phone, created_at desc)
  where phone is not null;

-- -----------------------------------------------------------------------------
-- 3) Backfill history with the same buyer-scoped rule the app now applies.
--    Phone identity = last 10 digits, mirroring phoneKey() in lib/shopify/recovery.ts.
--    Window = 3 days, mirroring PHONE_ATTRIBUTION_WINDOW_MS.
-- -----------------------------------------------------------------------------
with conv as (
  select
    id,
    organisation_id,
    right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) as pk,
    converted_at
  from public.shopify_recovery_attempts
  where converted_at is not null
    and phone is not null
),
-- Every touch we made to a buyer, one row per timestamp.
touches as (
  select
    a.organisation_id,
    right(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g'), 10) as pk,
    v.t as touched_at
  from public.shopify_recovery_attempts a
  cross join lateral (values (a.connected_at), (a.whatsapp_sent_at)) as v(t)
  where a.phone is not null
    and v.t is not null
),
first_touch as (
  select c.id, min(t.touched_at) as first_contact_at
  from conv c
  join touches t
    on t.organisation_id = c.organisation_id
   and t.pk = c.pk
   and t.touched_at <= c.converted_at
   and c.converted_at - t.touched_at <= interval '3 days'
  group by c.id
),
-- How long this buyer's OLDEST cart had been sitting when the order landed.
oldest as (
  select c.id, max(c.converted_at - s.created_at) as oldest_age
  from conv c
  join public.shopify_recovery_attempts s
    on s.organisation_id = c.organisation_id
   and right(regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g'), 10) = c.pk
   and s.created_at <= c.converted_at
   and c.converted_at - s.created_at <= interval '3 days'
  group by c.id
)
update public.shopify_recovery_attempts a
set
  first_contact_at = ft.first_contact_at,
  recovery_outcome = case
    when ft.first_contact_at is not null then 'recovered_by_us'
    when coalesce(o.oldest_age, interval '0') >= interval '10 minutes'
      then 'recovered_organic'
    else 'instant_sale'
  end
from conv c
left join first_touch ft on ft.id = c.id
left join oldest o on o.id = c.id
where a.id = c.id
  and a.recovery_outcome is null;

-- Converted rows with no phone at all can't be buyer-scoped; label them by the
-- only signal available (their own age) so nothing converted is left unlabelled.
update public.shopify_recovery_attempts
set recovery_outcome = case
      when converted_at - created_at >= interval '10 minutes' then 'recovered_organic'
      else 'instant_sale'
    end
where converted_at is not null
  and recovery_outcome is null;

-- -----------------------------------------------------------------------------
-- 4) shopify_order_events — the durable order ledger.
--    Unique on (organisation_id, order_id) so redelivery, orders/create followed
--    by orders/paid, and our own retries all collapse to ONE settlement.
--    Service-role only: RLS on, no authenticated policies (mirrors
--    bolna_integrations). Nothing here is read by the client.
-- -----------------------------------------------------------------------------
create table if not exists public.shopify_order_events (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  shop_domain      text not null,
  -- Shopify's numeric order id, as text. The idempotency key.
  order_id         text not null,
  topic            text not null,
  -- The match keys, snapshotted so a retry needs no second Shopify call.
  checkout_token   text,
  cart_token       text,
  phone            text,
  order_created_at timestamptz,
  -- Null until settled. The cron tick drains rows where this is still null.
  processed_at     timestamptz,
  attempts         smallint not null default 0,
  last_error       text,
  created_at       timestamptz not null default now(),
  unique (organisation_id, order_id)
);

-- The drain query: unprocessed, oldest first, giving up after a few tries.
create index if not exists shopify_order_events_unprocessed_idx
  on public.shopify_order_events (created_at)
  where processed_at is null;

alter table public.shopify_order_events enable row level security;

comment on table public.shopify_order_events is
  'Durable ledger of Shopify order webhooks. Written BEFORE settlement so a '
  'failure inside next/after() (which runs after we have already 200''d Shopify, '
  'so Shopify never retries) can be replayed by the cron tick. Unique on '
  '(organisation_id, order_id) — redelivery and orders/create+orders/paid for the '
  'same order settle exactly once. Service-role only.';
