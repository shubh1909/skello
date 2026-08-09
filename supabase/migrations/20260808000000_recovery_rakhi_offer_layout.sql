-- =============================================================================
-- 20260808000000 — Add the 'rakhi_offer' WhatsApp recovery template layout.
-- =============================================================================
-- A third message body joins classic (6 vars) and coupon_link (4 vars): the
-- FESTIVE TIERED layout. It reminds the shopper of the cart and its value, then
-- pitches a volume ladder instead of a single coupon —
--
--     Buy 1 – Get 15% Off / Buy 2 – Get 25% Off / Buy 3 – Get 35% Off
--
-- — and closes with the same short checkout link every layout sends. The tiers
-- are STATIC copy inside the Meta-approved body (the saving depends on how many
-- items the shopper adds, which we can't know at send time), so the parameter
-- count stays at 4: {{1}} customer_name, {{2}} top_product, {{3}} cart_total,
-- {{4}} discount_link. See lib/shopify/recovery-templates.ts.
--
-- ⚠️ Same parameter COUNT as coupon_link, different parameter MEANING ({{3}} is
-- the cart total here, the store name there). Meta validates count only, so an
-- org that switches layout without also pointing whatsapp_template_name at the
-- matching approved template sends a well-formed but wrong message — no error.
--
-- The original constraint was created inline by 20260716000000's ADD COLUMN, so
-- it carries Postgres' generated name; drop by that name and re-add explicitly
-- so this list is nameable next time. Widening a check is not a rewrite, but it
-- does take an ACCESS EXCLUSIVE lock while every existing row is validated —
-- one row per org, so effectively instant.
-- =============================================================================

alter table public.shopify_recovery_settings
  drop constraint if exists shopify_recovery_settings_whatsapp_template_layout_check;

alter table public.shopify_recovery_settings
  add constraint shopify_recovery_settings_whatsapp_template_layout_check
    check (whatsapp_template_layout in ('classic', 'coupon_link', 'rakhi_offer'));

comment on column public.shopify_recovery_settings.whatsapp_template_layout is
  'Which WhatsApp recovery template body the org uses: classic (6 vars), '
  'coupon_link (4 vars, pre-applied checkout link) or rakhi_offer (4 vars, '
  'tiered festive offer, no coupon code). Drives positional variable mapping '
  'in the send pipeline.';
