-- =============================================================================
-- 20260716000002 — Split the discount code into written vs spoken forms.
-- =============================================================================
-- One field was doing two incompatible jobs. The voice agent cannot reliably
-- read an alphanumeric code aloud ("GRAB20" comes out hallucinated), so orgs
-- worked around it by typing the code phonetically — "grab twenty" — into
-- offer_code. But offer_code is ALSO the code we push into the WhatsApp template
-- and the /discount/<code> checkout link, both of which need the code EXACTLY
-- ("grab twenty" is not a redeemable code). Fixing one broke the other.
--
--   shopify_recovery_settings.offer_code_spoken text  NEW. How the agent should
--       SAY the code, e.g. "grab twenty". Null/blank → fall back to offer_code.
--   shopify_recovery_attempts.offer_code_spoken text  NEW. Snapshotted onto the
--       attempt at schedule time (mirrors offer_label / offer_code), so a later
--       settings edit can't rewrite what an in-flight call was told to say.
--
-- offer_code keeps its original meaning: the EXACT redeemable code (GRAB20),
-- auto-filled from the selected Shopify discount. WhatsApp + the checkout link
-- read it; the agent reads offer_code_spoken.
--
-- ⚠️ BREAKING FOR LIVE ORGS — two manual steps per org, no automatic migration:
--   1. Any org that typed a phonetic code into "Discount code" must move it to
--      the new "How the agent says it" field and restore the exact code (easiest:
--      re-pick the discount from the dropdown, which auto-fills it).
--   2. The Bolna prompt must change {discount_code} → {discount_code_spoken}.
--      {discount_code} now resolves to the EXACT code, so a prompt left alone
--      will make the agent read "GRAB20" aloud and hallucinate again — silently,
--      on live calls. Nothing errors; it just says the wrong thing.
-- We cannot detect which orgs are affected: "grab twenty" is a syntactically
-- valid code, so there is no safe automatic backfill. See docs/cart-recovery.md.
-- =============================================================================

alter table public.shopify_recovery_settings
  add column if not exists offer_code_spoken text
    check (offer_code_spoken is null or char_length(offer_code_spoken) <= 200);

alter table public.shopify_recovery_attempts
  add column if not exists offer_code_spoken text;

comment on column public.shopify_recovery_settings.offer_code_spoken is
  'How the voice agent should SAY the discount code, e.g. "grab twenty" for '
  'GRAB20 — the agent cannot reliably read alphanumeric codes aloud. Feeds the '
  '{discount_code_spoken} prompt variable; blank falls back to offer_code. '
  'NEVER sent to WhatsApp or the checkout link — those need the exact code.';

comment on column public.shopify_recovery_attempts.offer_code_spoken is
  'Snapshot of settings.offer_code_spoken at schedule time, so editing settings '
  'cannot change what an already-scheduled call says.';
