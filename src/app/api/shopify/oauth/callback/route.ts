import { NextResponse, type NextRequest } from "next/server";

import { getShopifyConfig } from "@/lib/shopify/config";
import { saveShopifyIntegration } from "@/lib/shopify/integration";
import {
  OAUTH_STATE_COOKIE,
  exchangeCodeForToken,
  isValidShopDomain,
  verifyOAuthHmac,
  verifyOAuthState,
} from "@/lib/shopify/oauth";
import { logSkeloError, warnSkelo } from "@/lib/errors";

export const runtime = "nodejs"; // node:crypto + fetch to Shopify
export const dynamic = "force-dynamic";

// OAuth redirect target. Shopify sends the merchant here after they approve,
// with ?code, ?hmac, ?shop, ?state. We verify it's genuinely from Shopify
// (hmac), that we initiated it (signed state cookie), then trade the code for a
// permanent access token and persist it against the org.
//
//   GET /api/shopify/oauth/callback?code=…&hmac=…&shop=…&state=…
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const shop = params.get("shop")?.trim().toLowerCase();
  const code = params.get("code");
  const returnedState = params.get("state");

  if (!isValidShopDomain(shop) || !code || !returnedState) {
    return NextResponse.json(
      { error: "Invalid callback request" },
      { status: 400 },
    );
  }

  let config;
  try {
    config = getShopifyConfig();
  } catch (err) {
    const msg = logSkeloError("SHOPIFY-OAUTH", "Shopify not configured", {
      cause: err,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // 1. Authenticity — the HMAC over the query string proves it's from Shopify.
  if (!verifyOAuthHmac(params, config.clientSecret)) {
    warnSkelo("SHOPIFY-OAUTH", "Callback HMAC verification failed", { shop });
    return NextResponse.json({ error: "Invalid HMAC" }, { status: 401 });
  }

  // 2. CSRF — we must have started this install (signed state cookie), and the
  //    nonce + shop must match what we stored.
  const stored = verifyOAuthState(
    request.cookies.get(OAUTH_STATE_COOKIE)?.value,
    config.clientSecret,
  );
  if (!stored || stored.state !== returnedState || stored.shop !== shop) {
    warnSkelo("SHOPIFY-OAUTH", "Callback state validation failed", { shop });
    return NextResponse.json(
      { error: "State validation failed" },
      { status: 401 },
    );
  }

  // 3. Trade the one-time code for an offline access token and persist it.
  try {
    const token = await exchangeCodeForToken(shop, code, config);
    await saveShopifyIntegration({
      organisationId: stored.organisationId,
      shopDomain: shop,
      accessToken: token.access_token,
      scope: token.scope,
    });
  } catch (err) {
    const msg = logSkeloError("SHOPIFY-OAUTH", "Token exchange failed", {
      organisationId: stored.organisationId,
      shop,
      cause: err,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Clear the one-shot cookie and land the user back in the app.
  const res = NextResponse.redirect(
    `${config.appUrl}/settings?shopify=connected`,
  );
  res.cookies.delete(OAUTH_STATE_COOKIE);
  return res;
}
