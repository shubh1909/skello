-- Add 'shopify' to the lead source enum — abandoned-cart leads captured from a
-- store's Shopify webhook are attributed to this source. ADD VALUE is additive
-- and safe to re-run (IF NOT EXISTS); it isn't used in this same transaction.
alter type public.lead_source add value if not exists 'shopify';
