-- =============================================================================
-- 20260720000000 — Distinguish a genuine recovery from an instant sale.
-- =============================================================================
-- We record a recovery attempt the moment a checkout is created — but a checkout
-- is not an abandoned cart yet. Shopify only considers it abandoned ~10 minutes
-- after contact info is added, if no order follows. A shopper who checks out and
-- pays within that window (a normal fast purchase) was NEVER abandoned, so it
-- must not count as a recovery — yet these were inflating the recovered count and
-- cluttering the abandoned list with orders we never influenced.
--
--   shopify_recovery_attempts.is_recovery boolean  NEW, GENERATED.
--       true  = the cart survived the 10-min abandonment window and THEN
--               converted → a real recovery.
--       false = never converted, OR converted inside the window (instant sale).
--
-- Generated + stored so it applies the SAME rule to every row — including
-- historical ones — with no backfill, and can be filtered/indexed directly (a
-- column-to-column comparison isn't expressible in the query builder otherwise).
-- The 10-minute interval is hardcoded to mirror Shopify; the app constant
-- ABANDONMENT_THRESHOLD_MINUTES must stay in sync with it.
--
-- NOTE: written as `converted_at - created_at >= interval` (a timestamptz
-- SUBTRACTION, which is IMMUTABLE) rather than `created_at + interval` — adding
-- an interval to a timestamptz is only STABLE (timezone/DST dependent), and a
-- generated column must be immutable (Postgres 42P17).
-- =============================================================================

alter table public.shopify_recovery_attempts
  add column if not exists is_recovery boolean
    generated always as (
      converted_at is not null
      and converted_at - created_at >= interval '10 minutes'
    ) stored;

-- Feeds the Recovered tab + the recovered/revenue metrics.
create index if not exists shopify_recovery_attempts_is_recovery_idx
  on public.shopify_recovery_attempts (organisation_id)
  where is_recovery;

comment on column public.shopify_recovery_attempts.is_recovery is
  'True when the cart was abandoned (survived the ~10-min window) and then '
  'converted — a genuine recovery. False for never-converted carts and for '
  'instant sales that completed inside the window (never abandoned). Mirrors '
  'ABANDONMENT_THRESHOLD_MINUTES in lib/shopify/recovery.ts.';
