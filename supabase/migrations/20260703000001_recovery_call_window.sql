-- =============================================================================
-- Cart Recovery — org-configurable calling window.
--
-- Only dial abandoned-cart shoppers between `call_window_start` and
-- `call_window_end`, interpreted in the app timezone (IST / Asia/Kolkata). Both
-- null → no restriction (dial around the clock, the prior behaviour). A due call
-- that lands outside the window is deferred to the next window open, never
-- dropped. Times are stored tz-naive (a wall clock), evaluated in APP_TIMEZONE
-- by the drainer.
-- =============================================================================

alter table public.shopify_recovery_settings
  add column if not exists call_window_start time,
  add column if not exists call_window_end   time;
