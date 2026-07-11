-- -----------------------------------------------------------------------------
-- Cart recovery: drop the "which channel goes first" ordering.
--
-- The escalation model is now fixed: the voice agent always dials first, and
-- WhatsApp is released the moment the connected call ends (or as a fallback if
-- voice never connects). There is no longer a channel-ordering choice or a
-- fixed escalation gap, so first_channel and escalation_gap_minutes are removed.
--
-- WhatsApp timing is driven at runtime off the voice-track outcome
-- (applyShopifyRecoveryOutcome re-anchors shopify_recovery_attempts.whatsapp_next_at),
-- so no data migration of existing rows is needed.
-- -----------------------------------------------------------------------------
alter table public.shopify_recovery_settings
  drop column if exists first_channel,
  drop column if exists escalation_gap_minutes;
