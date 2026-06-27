import "server-only";

// Resolved Shopify app configuration, read from the environment. The client
// secret doubles as the HMAC key for OAuth callbacks (and, later, webhooks), so
// this module is server-only — none of it may reach the browser.
export interface ShopifyConfig {
  clientId: string;
  clientSecret: string;
  apiVersion: string;
  // Comma-separated, exactly as sent to Shopify (least-privilege — see docs).
  scopes: string;
  appUrl: string; // e.g. https://app.skelo.team (no trailing slash)
  redirectUri: string; // appUrl + the callback route below
}

// Keep in lockstep with the callback route's path.
const CALLBACK_PATH = "/api/shopify/oauth/callback";
const DEFAULT_SCOPES = "read_checkouts,read_orders";

// Throws a descriptive error if anything required is missing — callers (route
// handlers) translate that into a 500 rather than booting a half-configured
// OAuth flow.
export function getShopifyConfig(): ShopifyConfig {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const apiVersion = process.env.SHOPIFY_API_VERSION;
  const appUrl = process.env.SHOPIFY_APP_URL?.replace(/\/+$/, "");

  const missing = (
    [
      ["SHOPIFY_CLIENT_ID", clientId],
      ["SHOPIFY_CLIENT_SECRET", clientSecret],
      ["SHOPIFY_API_VERSION", apiVersion],
      ["SHOPIFY_APP_URL", appUrl],
    ] as const
  )
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(
      `Shopify integration not configured: missing ${missing.join(", ")}`,
    );
  }

  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    apiVersion: apiVersion!,
    scopes: process.env.SHOPIFY_SCOPES?.trim() || DEFAULT_SCOPES,
    appUrl: appUrl!,
    redirectUri: `${appUrl}${CALLBACK_PATH}`,
  };
}
