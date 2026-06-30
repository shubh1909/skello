-- =============================================================================
-- Cart Recovery — capture the recovery offer's numeric discount so the voice
-- agent can quote a real discounted cart value on the call.
--   offer_discount_value + offer_discount_kind are sourced from the chosen
--   Shopify price rule when the org saves the offer (settings), then snapshotted
--   onto each attempt at schedule time (mirrors offer_label / offer_code).
-- =============================================================================

-- Org-level offer config: the numeric lever behind offer_label/offer_code.
alter table public.shopify_recovery_settings
  add column if not exists offer_discount_value numeric(12,2)
    check (offer_discount_value is null or offer_discount_value >= 0),
  add column if not exists offer_discount_kind text
    check (offer_discount_kind is null or offer_discount_kind in ('percentage','fixed_amount'));

-- Per-attempt snapshot (taken when the attempt is scheduled), so the dispatch
-- tick can compute the discounted total without re-reading settings.
alter table public.shopify_recovery_attempts
  add column if not exists offer_discount_value numeric(12,2),
  add column if not exists offer_discount_kind text;
