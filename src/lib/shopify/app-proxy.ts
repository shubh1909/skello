import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Shopify App Proxy: the storefront path `https://<store>/apps/skelo/*` is
// served by Shopify from OUR origin, so the shopper only ever sees the store's
// own domain.
//
// Shopify appends `shop`, `path_prefix`, `timestamp` and `signature` to every
// proxied request.
//
// CONFIGURED PER CLIENT APP, not once. Skelo's model is one Dev-Dashboard app
// per client (each org carries its own client_id + api_secret), so EVERY
// client's app needs its own App Proxy entry — all pointing at the same URL
// (https://app.skelo.team/api/shopify/proxy), since this route resolves the
// tenant from the proxied `shop` param. Dev Dashboard → Apps → {app} →
// Versions → Create a version → App proxy. See docs/cart-recovery.md.

// The storefront prefix a proxied URL is built from. Must match every client
// app's App Proxy config exactly, or that client's links 404 on the storefront.
//
// NOTE: this is hardcoded, but Shopify lets a MERCHANT customise the prefix and
// subpath from their admin (Settings → Apps and sales channels → {app} → App
// proxy → Customize URL), and the values become immutable on that store once
// installed. A client who deviates from `apps` + `skelo` silently breaks their
// own links. If that ever happens in the wild, this belongs in a per-org column
// rather than here.
export const APP_PROXY_PREFIX = "/apps/skelo";

// Public short recovery link, on the STORE's domain (never ours).
export function buildShortRecoveryLink(
  storefrontOrigin: string,
  shortToken: string,
): string {
  return `${storefrontOrigin}${APP_PROXY_PREFIX}/r/${shortToken}`;
}

// --- Proxy health probe ----------------------------------------------------
// Misconfiguring a client's App Proxy fails SILENTLY: the token is minted, the
// message sends, and only the shopper ever sees the 404. The admin check
// (checkShopifyAppProxy) requests this reserved token through the storefront to
// surface that at onboarding instead.
//
// Underscores make it unable to collide with a real short token (exactly 12
// base62 chars, no punctuation), so it can never shadow a real cart.
export const PROXY_PROBE_TOKEN = "__skelo_probe__";

// The probe replies in plain text, because the states we need to tell apart are
// otherwise indistinguishable — "proxy not wired" yields Shopify's OWN themed
// 404, which never reaches our route at all. So: any marker below proves the
// request reached us, i.e. the proxy IS wired; their absence means it isn't.
//
// This path is deliberately chattier than the real one (which answers every
// failure with an identical opaque 404). That's safe ONLY because the probe
// token is a public constant with no cart behind it and reveals nothing a
// caller doesn't already know. Do not extend this pattern to real tokens.
export const PROXY_PROBE_OK = "SKELO_PROXY_OK";
export const PROXY_PROBE_BAD_SIGNATURE = "SKELO_PROXY_BAD_SIGNATURE";
export const PROXY_PROBE_UNKNOWN_SHOP = "SKELO_PROXY_UNKNOWN_SHOP";

// 12 base62 chars ≈ 71 bits — unguessable, and the link is a capability (holding
// it means you received the message), so it must not be enumerable.
const TOKEN_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const TOKEN_LENGTH = 12;

export function newShortToken(): string {
  // Rejection-free modulo bias is irrelevant at 62/256 skew for an opaque id,
  // but 256 % 62 != 0 would bias the first 8 chars — so draw a byte per char
  // from a 248-value window (4×62) and redraw the tail.
  let out = "";
  while (out.length < TOKEN_LENGTH) {
    for (const byte of randomBytes(TOKEN_LENGTH)) {
      if (byte >= 248) continue; // outside 4 full 62-char cycles → biased
      out += TOKEN_ALPHABET[byte % 62];
      if (out.length === TOKEN_LENGTH) break;
    }
  }
  return out;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Build the message Shopify signs for an App Proxy request: every query param
 * EXCEPT `signature`, each rendered `key=value` (repeated keys joined by `,`),
 * the rendered STRINGS sorted, then concatenated with NO separator.
 *
 * This is a THIRD scheme, distinct from the two already in this codebase:
 *   - App proxy (here):    hex, sorted `key=value` joined by ""      → `signature`
 *   - OAuth callback:      hex, sorted `key=value` joined by "&"     → `hmac`
 *   - Webhooks:            base64 over the RAW body                  → header
 * Joining with "&" here (the OAuth habit) silently fails every request.
 *
 * Note the sort is over the rendered `key=value` strings — matching Shopify's
 * reference `collect{...}.sort.join` — not over the keys alone.
 */
export function appProxySignatureMessage(params: URLSearchParams): string {
  const byKey = new Map<string, string[]>();
  for (const [k, v] of params.entries()) {
    if (k === "signature") continue;
    const existing = byKey.get(k);
    if (existing) existing.push(v);
    else byKey.set(k, [v]);
  }
  return [...byKey.entries()]
    .map(([k, values]) => `${k}=${values.join(",")}`)
    .sort()
    .join("");
}

export function computeAppProxySignature(
  params: URLSearchParams,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(appProxySignatureMessage(params))
    .digest("hex");
}

export function verifyAppProxySignature(
  params: URLSearchParams,
  secret: string,
): boolean {
  const signature = params.get("signature");
  if (!signature) return false;
  return safeEqual(computeAppProxySignature(params, secret), signature);
}
