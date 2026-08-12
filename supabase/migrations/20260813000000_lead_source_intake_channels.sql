-- Lead sources for the Integrations surface.
--
-- Granular per-channel values rather than one generic 'ad' / 'portal' bucket:
-- the leads table filters on this enum and the pipeline tabs group by it, and a
-- builder wants "Google Ads" and "99acres" as separate lines, not one pile.
-- Each future portal (Magicbricks, Housing) is one more ADD VALUE here.
--
-- 'whatsapp' already exists from the baseline — Click-to-WhatsApp leads reuse it
-- rather than adding a near-duplicate; the ad context lives in custom_data.
--
-- ⚠️ Its own migration, and the values are NOT used anywhere in this file.
-- ADD VALUE cannot be used in the transaction that adds it. Same discipline as
-- 20260628000000_lead_source_shopify.sql.
alter type public.lead_source add value if not exists 'google_ads';
alter type public.lead_source add value if not exists 'portal_99acres';
