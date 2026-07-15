-- =============================================================================
-- 20260715000000 — Cart-token match + phone safety net for recovery cancel.
-- =============================================================================
-- A recovered order failed to cancel its pending recovery call: we matched the
-- order to the tracked cart on `checkout_token` ALONE, but that token diverges
-- from the one seen on checkouts/* when the shopper completes in a different
-- checkout session (Shop Pay / accelerated / the new one-page checkout). Shopify
-- attributes recovery via the stable `cart_token`, so we now capture it and
-- match on EITHER token — with the buyer phone as a last-resort cancel.
--
--   shopify_recovery_attempts.cart_token text  NEW. Shopify cart token from the
--       checkouts/* payload; nullable (older rows / payloads without it).
-- =============================================================================

alter table public.shopify_recovery_attempts
  add column if not exists cart_token text;

-- orders/create → cancel: match the tracked cart by cart_token when
-- checkout_token no longer lines up.
create index if not exists shopify_recovery_attempts_cart_token_idx
  on public.shopify_recovery_attempts (organisation_id, cart_token)
  where cart_token is not null;

-- Phone safety-net cancel: scan an org's LIVE (pending/in_flight) attempts to
-- stop any recovery for a phone that just purchased, even when both tokens
-- differ. Partial index keeps the scan cheap.
create index if not exists shopify_recovery_attempts_org_phone_open_idx
  on public.shopify_recovery_attempts (organisation_id, phone)
  where status in ('pending', 'in_flight') and phone is not null;
