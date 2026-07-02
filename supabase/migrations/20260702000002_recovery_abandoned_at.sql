-- =============================================================================
-- Cart Recovery — store Shopify's own checkout-created timestamp so the
-- dashboard's "Abandoned at" matches Shopify, instead of showing our webhook
-- receipt time (`created_at`, which can lag the real abandonment). Scheduling
-- still keys off our own timing; this column is display-only.
-- =============================================================================

alter table public.shopify_recovery_attempts
  add column if not exists abandoned_at timestamptz;
