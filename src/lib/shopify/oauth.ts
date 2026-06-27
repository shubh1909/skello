import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { ShopifyConfig } from "./config";

// One-shot, signed cookie that carries the OAuth `state` nonce (CSRF defence)
// plus which org/shop the eventual token belongs to. Set on /api/shopify/install,
// read + cleared on the callback.
export const OAUTH_STATE_COOKIE = "shopify_oauth";

// Only ever talk to *.myshopify.com — the canonical store host. This guards the
// install + callback against an attacker pointing us at an arbitrary domain.
const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export function isValidShopDomain(
  shop: string | null | undefined,
): shop is string {
  return !!shop && SHOP_DOMAIN_RE.test(shop);
}

function safeEqual(a: string, b: string): boolean {
  // Constant-time compare; bail on length mismatch (timingSafeEqual throws on
  // unequal-length buffers).
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Verify the HMAC Shopify appends to the OAuth callback query string. The signed
 * message is every query param EXCEPT `hmac` (and the legacy `signature`),
 * sorted by key and joined as `key=value` with `&`, signed HMAC-SHA256 → hex.
 *
 * NOTE: this is the OAuth-callback scheme (hex over the sorted query string).
 * Webhooks use a *different* scheme — base64 over the raw request body.
 */
export function verifyOAuthHmac(
  params: URLSearchParams,
  secret: string,
): boolean {
  const hmac = params.get("hmac");
  if (!hmac) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const digest = createHmac("sha256", secret).update(message).digest("hex");
  return safeEqual(digest, hmac);
}

// Build the authorize URL the merchant is redirected to. No `grant_options[]` →
// Shopify issues an *offline* (permanent) token, which is what background jobs
// (webhook registration, checkout reads) need.
export function buildInstallUrl(
  shop: string,
  state: string,
  config: ShopifyConfig,
): string {
  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("scope", config.scopes);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export interface TokenResponse {
  access_token: string;
  scope: string;
}

// Trade the one-time authorization code for an access token. Uses the client
// id + secret, so it only runs server-side.
export async function exchangeCodeForToken(
  shop: string,
  code: string,
  config: ShopifyConfig,
): Promise<TokenResponse> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Token exchange failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  const json = (await res.json()) as Partial<TokenResponse>;
  if (!json.access_token) {
    throw new Error("Token exchange response missing access_token");
  }
  return { access_token: json.access_token, scope: json.scope ?? "" };
}

// --- signed state cookie ---------------------------------------------------

export interface OAuthState {
  state: string; // random nonce, echoed back as ?state=
  organisationId: string; // who the resulting token is attached to
  shop: string; // the store we expect the callback for
  ts: number; // issued-at (ms), for expiry
}

const STATE_TTL_MS = 10 * 60 * 1000; // 10 min to complete the handshake

// `value.sig`, both base64url. Signed with the app secret so a client can't
// forge the org/shop it points at.
export function signOAuthState(payload: OAuthState, secret: string): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyOAuthState(
  value: string | undefined,
  secret: string,
): OAuthState | null {
  if (!value) return null;
  const [data, sig] = value.split(".");
  if (!data || !sig) return null;
  const expected = createHmac("sha256", secret).update(data).digest("base64url");
  if (!safeEqual(sig, expected)) return null;

  let parsed: OAuthState;
  try {
    parsed = JSON.parse(
      Buffer.from(data, "base64url").toString("utf8"),
    ) as OAuthState;
  } catch {
    return null;
  }
  if (
    typeof parsed.ts !== "number" ||
    Date.now() - parsed.ts > STATE_TTL_MS ||
    !parsed.state ||
    !parsed.organisationId ||
    !parsed.shop
  ) {
    return null;
  }
  return parsed;
}
