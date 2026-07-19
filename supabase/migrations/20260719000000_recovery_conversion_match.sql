-- =============================================================================
-- 20260719000000 — Record HOW a conversion was matched (token vs phone).
-- =============================================================================
-- A recovered cart can be matched to its order two ways, and they mean different
-- things when reconciling against Shopify:
--   'token' — matched on checkout_token / cart_token. Shopify attributes the
--             SAME way, so this conversion also shows as "recovered" in Shopify.
--   'phone' — matched on the buyer phone because the order carried no tokens
--             (GoKwik / custom checkout). Shopify CANNOT attribute these — they
--             appear as plain orders in its Orders tab, never "recovered".
--
-- Storing which one lets the UI explain a discrepancy at a glance ("these N are
-- phone-attributed GoKwik conversions Shopify doesn't track") instead of it
-- looking like a data error.
--
--   shopify_recovery_attempts.conversion_match text  NEW. 'token' | 'phone'.
--       Null for non-converted rows and for conversions recorded before this.
-- =============================================================================

alter table public.shopify_recovery_attempts
  add column if not exists conversion_match text
    check (conversion_match is null or conversion_match in ('token', 'phone'));

comment on column public.shopify_recovery_attempts.conversion_match is
  'How the conversion was matched to its order: token (Shopify agrees) or phone '
  '(tokenless GoKwik/custom checkout — invisible to Shopify recovery). Null until '
  'converted.';
