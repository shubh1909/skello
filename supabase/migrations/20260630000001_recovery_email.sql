-- =============================================================================
-- Cart Recovery — persist the shopper's email on the attempt.
--   Shopify fires checkouts/{create,update} as soon as the email (contact) step
--   is done, often before name/phone/address exist. We already parse the email
--   in normalizeAbandonedCheckout but dropped it on the floor; keep it so the
--   dashboard can identify an email-only abandoned cart.
-- =============================================================================

alter table public.shopify_recovery_attempts
  add column if not exists email text;
