import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

// The scopes we request at authorization. The client's app must be configured
// with (at least) these same scopes, or Shopify rejects the authorize request.
export const SHOPIFY_OAUTH_SCOPES =
  "read_all_orders,read_assigned_fulfillment_orders,write_assigned_fulfillment_orders,read_customer_events,read_cart_transforms,write_cart_transforms,read_all_cart_transforms,read_validations,write_validations,write_checkouts,read_checkouts,read_customers,write_customers,read_price_rules,write_price_rules,read_discounts,write_discounts,read_discounts_allocator_functions,write_discounts_allocator_functions,write_inventory,read_inventory,read_orders,write_orders,read_payment_terms,write_payment_terms,read_products,write_products,read_purchase_options,write_purchase_options";

// One-shot, signed cookie carrying the OAuth `state` nonce (CSRF defence) plus
// which org/shop the eventual token belongs to. Set on /api/shopify/install,
// read + cleared on the callback. Signed with the org's own api_secret.
export const OAUTH_STATE_COOKIE = "shopify_oauth";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Verify the HMAC Shopify appends to the OAuth callback query string. The signed
 * message is every query param EXCEPT `hmac` (and the legacy `signature`),
 * sorted by key and joined as `key=value` with `&`, signed HMAC-SHA256 → hex.
 *
 * This is the OAuth-callback scheme (hex over the sorted query string) — webhooks
 * use a DIFFERENT scheme (base64 over the raw body); see webhooks.ts.
 */
export function oauthHmacMessage(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

export function computeOAuthHmac(
  params: URLSearchParams,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(oauthHmacMessage(params))
    .digest("hex");
}

export function verifyOAuthHmac(
  params: URLSearchParams,
  secret: string,
): boolean {
  const hmac = params.get("hmac");
  if (!hmac) return false;
  return safeEqual(computeOAuthHmac(params, secret), hmac);
}

// Build the authorize URL the merchant is redirected to, using THIS client's
// API key. No `grant_options[]` → Shopify issues an offline (permanent) token.
export function buildInstallUrl(input: {
  shop: string;
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(`https://${input.shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("scope", SHOPIFY_OAUTH_SCOPES);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

export interface TokenResponse {
  access_token: string;
  scope: string;
}

// Trade the one-time code for an access token, using this client's API key +
// secret. Server-side only.
export async function exchangeCodeForToken(input: {
  shop: string;
  code: string;
  clientId: string;
  clientSecret: string;
}): Promise<TokenResponse> {
  const res = await fetch(`https://${input.shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
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
