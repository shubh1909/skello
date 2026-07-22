-- =============================================================================
-- 20260722000001 — Record the ORDER, not just the cart we hoped for.
-- =============================================================================
-- WHY
-- ----
-- `cart_total` is snapshotted when the checkout is abandoned and never revisited,
-- yet it is what "revenue recovered" sums. The two are not the same number, and
-- the gap is BIASED, not random: the whole point of the offer (e.g. GRAB20) is to
-- reduce what the shopper finally pays, so every discounted recovery is reported
-- ~20% high. Shoppers also add and remove items between abandoning and buying.
--
-- The order payload we already receive on orders/* carries the real figure, so
-- this costs no extra Shopify API call — we simply stopped throwing it away.
--
--   order_id       — Shopify's numeric order id, as text. Also the deep link:
--                    https://<shop>/admin/orders/<order_id>
--   order_number   — the human "#1046" the merchant actually recognises.
--   order_total    — what the shopper really paid. Revenue reads this, falling
--                    back to cart_total for rows settled before this migration.
--   order_currency — the order's presentment currency, which can differ from the
--                    cart's if the shopper switched markets.
--
-- LIMITATION (deliberate, tracked): this is the total AT SETTLEMENT. A later
-- cancellation or refund does not walk it back — we do not subscribe to
-- orders/cancelled or refunds/create yet. With COD/GoKwik RTO rates that is a
-- real overstatement, and it is the next thing worth closing.
-- =============================================================================

alter table public.shopify_recovery_attempts
  add column if not exists order_id text,
  add column if not exists order_number text,
  add column if not exists order_total numeric(12,2),
  add column if not exists order_currency text;

comment on column public.shopify_recovery_attempts.order_total is
  'What the shopper actually paid, captured from the orders/* payload at '
  'settlement. Prefer this over cart_total for revenue — cart_total is the '
  'pre-discount value at abandonment and overstates every discounted recovery. '
  'Null for rows settled before 20260722000001; fall back to cart_total there.';

comment on column public.shopify_recovery_attempts.order_id is
  'Shopify order id as text. Deep link: https://<shop_domain>/admin/orders/<order_id>.';

-- Lets a conversion be traced back from a Shopify order id without a scan.
create index if not exists shopify_recovery_attempts_order_id_idx
  on public.shopify_recovery_attempts (organisation_id, order_id)
  where order_id is not null;

-- The ledger already holds the keys; carry the value too so a replayed
-- settlement records the same figures the original delivery would have.
alter table public.shopify_order_events
  add column if not exists order_number text,
  add column if not exists order_total numeric(12,2),
  add column if not exists order_currency text;
