-- =============================================================================
-- Cart Recovery — record the shopper's marketing-consent state on the attempt.
--   Policy change: we now call every cart that has a phone, regardless of
--   marketing consent. We still CAPTURE the consent flag (rather than gate on
--   it) so the org can filter/report on it later if a regulator ever asks.
-- =============================================================================

alter table public.shopify_recovery_attempts
  add column if not exists marketing_consent boolean;
