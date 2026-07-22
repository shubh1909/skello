---
name: skelo-recovery
description: Shopify abandoned-cart recovery in Skelo — webhook ingest and HMAC, checkout/cart tokens, the App Proxy short-link redirect, GoKwik tokenless phone attribution, conversion matching, and the is_recovery vs converted_at distinction. Load this for any task touching shopify_recovery_attempts/settings, the shopify webhook, the proxy route, recovery metrics, or cart-recovery dispatch.
---

# Skelo Shopify Cart Recovery

Load `skelo-tenancy` alongside. WhatsApp send mechanics live in `skelo-whatsapp`; dialling in `skelo-voice-agent`.

## Entry points

| Path | Role |
|---|---|
| `src/app/api/webhooks/shopify/route.ts` | Single multi-tenant webhook endpoint |
| `src/app/api/shopify/proxy/r/[token]/route.ts` | Short-link redirect (App Proxy) |
| `src/app/api/shopify/install/route.ts`, `oauth/callback/route.ts` | Per-client OAuth |
| `src/app/api/cron/campaigns/tick/route.ts` | Shared drainer tick |
| `src/lib/shopify/recovery.ts` | The engine |

## Ingest

`route.ts:30` resolves the tenant from the **`x-shopify-shop-domain` header, never the payload**. `:49` `resolveShopifyIntegrationByShop`; `:55` HMAC verified with **that store's** `api_secret` over the **raw body** (`webhooks.ts:21-35`, base64 + `timingSafeEqual`).

Unknown/disabled shop → **200 ack** (`:52`) so Shopify stops retrying. Work is deferred via `after()` (`:74`) to beat Shopify's ~5s deadline — **so handler failures are invisible to Shopify** and surface only in `logSkeloError`.

## Schedule (`checkouts/create|update` → `recovery.ts:148`)

- `:152` `normalizeAbandonedCheckout` — phone falls back `p.phone → customer → shipping → billing`; captures **both** `token` (checkout) and `cart_token`
- `:179` load existing by `checkout_token`; bail if `in_flight/succeeded/canceled/failed`
- `:245` `findOrCreateShopifyLead` — the leads seam (see `skelo-leads`)
- `:294` outreach anchors at **`now + ABANDONMENT_THRESHOLD_MS` (10 min) + `wait_minutes`**, then `clampToCallWindow`
- `:370` `short_token: newShortToken()` — minted **once per row lifetime**, deliberately absent from the already-active refresh path (`:338-355`) because rotating would dead-link a WhatsApp message already sent

## Convert / cancel (`orders/create` → `recovery.ts:496`) — two tiers

1. **`:512-538` token match** — `checkout_token OR cart_token`. Converts *all* matches. `conversion_match='token'`.
2. **`:550-610` phone fallback** (GoKwik / tokenless). Matches **last-10 digits** (`phoneKey`, `:389`) and **includes `succeeded`** rows (`:558`) — a connected call flips status to `succeeded`, so the old net missed exactly the carts we worked hardest on.
   `selectPhoneConversion` (`:438`) credits **exactly one** attempt (connected-first, then most recent) but **cancels all live ones**. The separation is intentional: revenue sums `cart_total` across converted rows, so multi-credit would double-count.

`PHONE_ATTRIBUTION_WINDOW_MS` = 3 days, with a **1-hour forward grace** (`:412`) for clock skew.

## Click attribution

Proxy route `:124` scopes the lookup by `organisation_id` from the **verified shop** *plus* `short_token` — never token alone (cross-tenant defence). `:138` records `clicked_at`, first-click-only, best-effort, never blocking.

## Tables

`shopify_recovery_attempts` — unique `(organisation_id, checkout_token)`; status `pending|in_flight|succeeded|failed|canceled|skipped`; **independent `whatsapp_status` track**. Added incrementally: `cart_token` (`20260715000000`), `short_token`/`clicked_at` (`20260716000001`), `conversion_match` `'token'|'phone'` (`20260719000000`), `is_recovery` (`20260720000000`).

`shopify_recovery_settings` — one row per org, PK `organisation_id`; `offer_type` `none|discount_code|free_product`, `call_window_start/end`.

`calls.shopify_recovery_attempt_id` — the seam back to the dial pipeline.

## Critical distinctions

### "converted" ≠ "recovered"

`converted_at` **includes instant sales** inside the 10-minute window. Recovered counts and revenue **must filter `is_recovery`**. Using `converted_at` for metrics is the easiest wrong answer in this domain.

### `is_recovery` is a GENERATED STORED column

`converted_at - created_at >= interval '10 minutes'`. Written as *subtraction* deliberately — `created_at + interval` on `timestamptz` is only STABLE, and generated columns must be IMMUTABLE (Postgres 42P17).

**It duplicates `ABANDONMENT_THRESHOLD_MINUTES` (`recovery.ts:44`) — two sources of truth.** Changing the TS constant silently desyncs historical and new rows. Change both together or neither.

### `conversion_match='phone'` will never reconcile with Shopify's own "recovered" figure

By design, not a data error — GoKwik orders carry no tokens, so Shopify shows them as plain orders.

## Gotchas

- **The proxy route must NOT 302.** `route.ts:34-40`: Shopify's App Proxy follows redirects server-side and **strips `Set-Cookie`**, losing the cart-restoring session. It returns an HTML page that self-navigates. A "cleanup" refactor to `NextResponse.redirect` **breaks checkout**.
- **`APP_PROXY_PREFIX = "/apps/skelo"` is hardcoded** (`app-proxy.ts:29`) but merchants can customise it in Shopify admin, and it becomes immutable post-install. A deviating client silently 404s every link. App Proxy setup is a **per-client manual step** — until done, tokens mint fine and only the shopper sees the 404.
- `PROXY_PROBE_TOKEN` (`__skelo_probe__`) is a health probe that intentionally returns chatty 200 markers, while real tokens get uniform opaque 404s (`notFound()`, `:63`). **Do not extend the chatty pattern** to real tokens.
- **`buildCheckoutLink` (`:790`) vs `buildMessageLink` (`:811`)** look competing but are distinct: the first is the long real destination resolved by the proxy; the second is what actually ships in WhatsApp (short link, falls back to long). **The message does not contain the discount URL.**
- Phone fallback fetches all org open attempts then filters in JS (`:562`); the index `shopify_recovery_attempts_org_phone_open_idx` doesn't cover the `succeeded` rows now included.
- Cart recovery **reuses the campaign cron tick** but is a **separate queue** (`recovery.ts:28-32`, `BATCH_LIMIT=100`, `CONCURRENCY=25`). The `campaigns/templates/cart-recovery` UI route is a template surface, **not** the recovery engine.

## 🐛 Known issue

**Marketing consent is captured but never enforced** — `recovery.ts:164` messages every cart with a phone regardless of `marketing_consent`. See `skelo-whatsapp`.
