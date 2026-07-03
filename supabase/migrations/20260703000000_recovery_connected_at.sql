-- =============================================================================
-- Cart Recovery — record the moment we actually reach the shopper.
--
-- `connected_at` is stamped the first time a recovery dial is answered (the call
-- reaches `in_progress`) or completes. Once set, the attempt is `succeeded` and
-- the drainer never dials that customer again — reaching them once is the whole
-- job. This makes "don't call a shopper we've already spoken to" explicit rather
-- than relying on a clean `completed` status (an answered-then-dropped call used
-- to re-arm and dial again).
-- =============================================================================

alter table public.shopify_recovery_attempts
  add column if not exists connected_at timestamptz;
