import { NextResponse, type NextRequest } from "next/server";

import { logSkeloError, warnSkelo } from "@/lib/errors";
import {
  resolveShopifyIntegrationByShop,
  setShopifyAccessToken,
} from "@/lib/shopify/integration";
import {
  OAUTH_STATE_COOKIE,
  computeOAuthHmac,
  exchangeCodeForToken,
  verifyOAuthHmac,
  verifyOAuthState,
} from "@/lib/shopify/oauth";
import { normalizeShopDomain } from "@/lib/shopify/util";

export const runtime = "nodejs"; // node:crypto + fetch to Shopify
export const dynamic = "force-dynamic";

function appOrigin(request: NextRequest): string {
  return (
    process.env.SHOPIFY_APP_URL?.replace(/\/+$/, "") || request.nextUrl.origin
  );
}

// OAuth redirect target. Shopify sends the merchant here after they approve. We
// resolve the tenant from the shop domain, verify it's genuinely from Shopify
// (hmac, using that store's secret), confirm we started it (signed state
// cookie), then trade the code for the access token and save it.
//
//   GET /api/shopify/oauth/callback?code=…&hmac=…&shop=…&state=…
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const shop = normalizeShopDomain(params.get("shop"));
  const code = params.get("code");
  const returnedState = params.get("state");

  if (!shop || !code || !returnedState) {
    return NextResponse.json(
      { error: "Invalid callback request" },
      { status: 400 },
    );
  }

  // The credentials must already be saved (that's where the secret + key live).
  const integration = await resolveShopifyIntegrationByShop(shop);
  if (!integration) {
    return NextResponse.json(
      { error: "No saved credentials for this store" },
      { status: 400 },
    );
  }

  // 1. Authenticity — HMAC over the query string, with this store's secret.
  if (!verifyOAuthHmac(params, integration.api_secret)) {
    // Diagnostic (no secret value, only its length): if `computed` ≠ `received`
    // the stored api_secret is wrong / from a different app than client_id.
    warnSkelo("SHOPIFY", "OAuth callback HMAC verification failed", {
      shop,
      received_hmac: params.get("hmac"),
      computed_hmac: computeOAuthHmac(params, integration.api_secret),
      api_secret_length: integration.api_secret.length,
      client_id_prefix: integration.client_id.slice(0, 6),
    });
    return NextResponse.json({ error: "Invalid HMAC" }, { status: 401 });
  }

  // 2. CSRF — we started this install (signed state cookie), and the nonce,
  //    shop, and org all match. A missing cookie (hasCookie:false) means the
  //    flow didn't begin at /api/shopify/install — e.g. opened from Shopify.
  const cookieValue = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const stored = verifyOAuthState(cookieValue, integration.api_secret);
  if (
    !stored ||
    stored.state !== returnedState ||
    stored.shop !== shop ||
    stored.organisationId !== integration.organisation_id
  ) {
    warnSkelo("SHOPIFY", "OAuth callback state validation failed", {
      shop,
      hasCookie: Boolean(cookieValue),
      cookieParsed: Boolean(stored),
      stateMatch: stored ? stored.state === returnedState : null,
      shopMatch: stored ? stored.shop === shop : null,
      orgMatch: stored ? stored.organisationId === integration.organisation_id : null,
    });
    return NextResponse.json(
      { error: "State validation failed" },
      { status: 401 },
    );
  }

  // 3. Trade the code for the access token (this client's key + secret) + save.
  try {
    const token = await exchangeCodeForToken({
      shop,
      code,
      clientId: integration.client_id,
      clientSecret: integration.api_secret,
    });
    await setShopifyAccessToken({
      organisationId: integration.organisation_id,
      accessToken: token.access_token,
      scope: token.scope,
    });
  } catch (err) {
    const msg = logSkeloError("SHOPIFY", "OAuth token exchange failed", {
      organisationId: integration.organisation_id,
      shop,
      cause: err,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const res = NextResponse.redirect(
    `${appOrigin(request)}/admin/organisations/${integration.organisation_id}/shopify?authorized=1`,
  );
  res.cookies.delete(OAUTH_STATE_COOKIE);
  return res;
}
