-- =============================================================================
-- 20260716000001 — Short recovery link (App Proxy) + click tracking.
-- =============================================================================
-- The coupon_link template sent Shopify's abandoned-checkout URL wrapped in a
-- /discount/<code>?redirect=<url-encoded checkout path> — ~130+ characters of
-- opaque token and percent-encoding in a WhatsApp message. We now send a short
-- link on the STORE's own domain, proxied back to us:
--
--     https://<store>/apps/skelo/r/<short_token>
--
-- The route resolves the token, records the click, and hands the browser the
-- real (long) checkout URL. Serving it on the store's domain — rather than
-- app.skelo.team — keeps the message trustworthy to the shopper.
--
--   shopify_recovery_attempts.short_token text  NEW. Opaque base62 id minted at
--       activation; the ONLY thing the public link carries. Nullable: rows that
--       never activate (skipped) and pre-migration rows have none, and the link
--       builder falls back to the long URL when it's absent.
--   shopify_recovery_attempts.clicked_at timestamptz  NEW. First click only —
--       the redirect route never overwrites a non-null value.
--
-- NOTE: the short link only resolves once THAT CLIENT's App Proxy is configured
-- (Dev Dashboard → Apps → {client's app} → Versions → Create a version → App
-- proxy; prefix `apps`, subpath `skelo`, URL
-- https://app.skelo.team/api/shopify/proxy). Skelo runs one app per client, so
-- this is a PER-CLIENT step. Until it's done the token is minted but the
-- storefront path 404s — see docs/cart-recovery.md.
-- =============================================================================

alter table public.shopify_recovery_attempts
  add column if not exists short_token text,
  add column if not exists clicked_at  timestamptz;

-- The redirect route's only lookup: token → attempt. Unique so a mint collision
-- fails loudly on insert rather than resolving one shopper's link to another's
-- cart. Partial (token is null for skipped / pre-migration rows).
create unique index if not exists shopify_recovery_attempts_short_token_key
  on public.shopify_recovery_attempts (short_token)
  where short_token is not null;

comment on column public.shopify_recovery_attempts.short_token is
  'Opaque base62 id in the public short recovery link '
  '(https://<store>/apps/skelo/r/<short_token>). Capability token: whoever holds '
  'it received the message. Never reused, never rotated once sent.';

comment on column public.shopify_recovery_attempts.clicked_at is
  'When the shopper FIRST opened the short recovery link. Attribution signal — '
  'a click proves the message drove the visit, independent of checkout_token.';
