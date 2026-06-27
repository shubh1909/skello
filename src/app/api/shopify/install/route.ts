import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";

import { requireSession } from "@/lib/auth/session";
import { getShopifyConfig } from "@/lib/shopify/config";
import {
  OAUTH_STATE_COOKIE,
  buildInstallUrl,
  isValidShopDomain,
  signOAuthState,
} from "@/lib/shopify/oauth";
import { logSkeloError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Begin the OAuth handshake. The signed-in user's org is the tenant the minted
// token will belong to — carried (signed) in the state cookie so the callback
// can attach it without trusting anything Shopify echoes back.
//
//   GET /api/shopify/install?shop=<store>.myshopify.com
export async function GET(request: NextRequest) {
  const session = await requireSession(); // redirects to /login if signed out

  const shop = request.nextUrl.searchParams
    .get("shop")
    ?.trim()
    .toLowerCase();
  if (!isValidShopDomain(shop)) {
    return NextResponse.json(
      { error: "Invalid or missing shop domain" },
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

  const state = randomBytes(16).toString("hex");
  const cookie = signOAuthState(
    {
      state,
      organisationId: session.organisation.id,
      shop,
      ts: Date.now(),
    },
    config.clientSecret,
  );

  const res = NextResponse.redirect(buildInstallUrl(shop, state, config));
  res.cookies.set(OAUTH_STATE_COOKIE, cookie, {
    httpOnly: true,
    // Dev over http:// would drop a Secure cookie — use an https tunnel locally.
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax", // survives the top-level GET redirect back from Shopify
    path: "/",
    maxAge: 600, // 10 min, matches the state TTL
  });
  return res;
}
