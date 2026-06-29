import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";

import { requireAdmin } from "@/lib/auth/admin";
import { logSkeloError } from "@/lib/errors";
import { getShopifyIntegration } from "@/lib/shopify/integration";
import {
  OAUTH_STATE_COOKIE,
  buildInstallUrl,
  signOAuthState,
} from "@/lib/shopify/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The callback path Shopify redirects back to. Each client's app must whitelist
// {appUrl}{CALLBACK_PATH} as an Allowed redirection URL.
const CALLBACK_PATH = "/api/shopify/oauth/callback";

function appOrigin(request: NextRequest): string {
  return (
    process.env.SHOPIFY_APP_URL?.replace(/\/+$/, "") || request.nextUrl.origin
  );
}

// Begin OAuth for a connected org's store. Admin-initiated: the signed-in admin
// picks the org (its credentials must already be saved). The state cookie is
// signed with the org's own api_secret and carries the org + shop so the
// callback can finish without trusting anything Shopify echoes back.
//
//   GET /api/shopify/install?organisation_id=<uuid>
export async function GET(request: NextRequest) {
  await requireAdmin(); // redirects non-admins

  const orgId = request.nextUrl.searchParams.get("organisation_id")?.trim();
  if (!orgId) {
    return NextResponse.json(
      { error: "Missing organisation_id" },
      { status: 400 },
    );
  }

  const integration = await getShopifyIntegration(orgId);
  if (!integration) {
    return NextResponse.json(
      { error: "Save the store credentials before authorizing" },
      { status: 400 },
    );
  }

  const state = randomBytes(16).toString("hex");
  let cookie: string;
  try {
    cookie = signOAuthState(
      {
        state,
        organisationId: orgId,
        shop: integration.shop_domain,
        ts: Date.now(),
      },
      integration.api_secret,
    );
  } catch (err) {
    const msg = logSkeloError("SHOPIFY", "Failed to start authorization", {
      organisationId: orgId,
      cause: err,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const redirectUri = `${appOrigin(request)}${CALLBACK_PATH}`;
  const res = NextResponse.redirect(
    buildInstallUrl({
      shop: integration.shop_domain,
      clientId: integration.client_id,
      redirectUri,
      state,
    }),
  );
  res.cookies.set(OAUTH_STATE_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax", // survives the top-level GET redirect back from Shopify
    path: "/",
    maxAge: 600,
  });
  return res;
}
