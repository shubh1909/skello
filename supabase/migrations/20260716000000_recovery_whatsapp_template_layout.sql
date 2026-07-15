-- =============================================================================
-- 20260716000000 — Per-org WhatsApp recovery template layout selector.
-- =============================================================================
-- Two message templates now coexist: the CLASSIC 6-variable body (cart summary +
-- discount code + saved-cart link) and the new COUPON_LINK 4-variable body (short
-- copy with a single checkout link that pre-applies the coupon). Each org picks
-- which layout its approved Meta template uses; the send pipeline maps variables
-- positionally per layout (see lib/shopify/recovery-templates.ts).
--
--   shopify_recovery_settings.whatsapp_template_layout text  NEW.
--       'classic' | 'coupon_link'. DEFAULT 'coupon_link'.
--
-- NOTE: defaulting to coupon_link flips existing orgs onto the new 4-variable
-- template. An org must point whatsapp_template_name at a Meta template whose
-- variable count matches the chosen layout, or sends fail with a param-count
-- error — the org can switch back to 'classic' from recovery settings.
-- =============================================================================

alter table public.shopify_recovery_settings
  add column if not exists whatsapp_template_layout text not null default 'coupon_link'
    check (whatsapp_template_layout in ('classic', 'coupon_link'));

comment on column public.shopify_recovery_settings.whatsapp_template_layout is
  'Which WhatsApp recovery template body the org uses: classic (6 vars) or '
  'coupon_link (4 vars, pre-applied checkout link). Drives positional variable '
  'mapping in the send pipeline.';
