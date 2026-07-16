import { NextResponse, type NextRequest } from "next/server";

import { logSkeloError } from "@/lib/errors";
import {
  PROXY_PROBE_BAD_SIGNATURE,
  PROXY_PROBE_OK,
  PROXY_PROBE_TOKEN,
  PROXY_PROBE_UNKNOWN_SHOP,
  verifyAppProxySignature,
} from "@/lib/shopify/app-proxy";
import { resolveShopifyIntegrationByShop } from "@/lib/shopify/integration";
import { buildCheckoutLink } from "@/lib/shopify/recovery";
import { normalizeShopDomain } from "@/lib/shopify/util";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs"; // node:crypto for the proxy signature
export const dynamic = "force-dynamic";

interface AttemptRow {
  id: string;
  recovery_url: string | null;
  offer_code: string | null;
  clicked_at: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Shopify's App Proxy FOLLOWS a 30x server-side and renders the result at the
// storefront path — it does not hand the redirect to the browser — and it
// STRIPS Set-Cookie from our response. A 302 to the checkout would therefore
// lose the very session cookies that restore the cart. So the browser must do
// the navigating: ship a minimal page that replaces the location itself.
// http-equiv covers a no-JS client; the <a> covers both failing.
function redirectPage(destination: string): string {
  const attr = escapeHtml(destination);
  const js = JSON.stringify(destination);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Taking you to your cart…</title>
<meta http-equiv="refresh" content="0;url=${attr}">
<script>window.location.replace(${js});</script>
<style>
body{font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;
min-height:100vh;display:flex;align-items:center;justify-content:center;
text-align:center;color:#111}
a{color:inherit}
</style>
</head>
<body><p>Taking you to your cart…<br><a href="${attr}">Continue</a></p></body>
</html>`;
}

function notFound(): NextResponse {
  // Deliberately opaque: a bad signature, an unknown shop and an unknown token
  // are indistinguishable from outside, so the link can't be probed.
  return new NextResponse("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

// 200, not 4xx: the admin check distinguishes proxy states by BODY, and a 404
// from us would be indistinguishable from Shopify's own "proxy not configured"
// 404 by status alone.
function probeResponse(marker: string): NextResponse {
  return new NextResponse(marker, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

// The short recovery link's landing point. The shopper only ever sees
// `https://<store>/apps/skelo/r/<token>`; Shopify proxies it here.
//
//   GET /api/shopify/proxy/r/:token?shop=…&path_prefix=…&timestamp=…&signature=…
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  if (!token) return notFound();

  // The health probe walks the SAME resolve→verify path as a real link, so a
  // pass proves the whole chain (proxy wired → shop known → api_secret correct),
  // not merely that something answered. It only reports each step instead of
  // collapsing them into one opaque 404.
  const isProbe = token === PROXY_PROBE_TOKEN;

  const params = request.nextUrl.searchParams;
  const shop = normalizeShopDomain(params.get("shop"));
  if (!shop) {
    return isProbe ? probeResponse(PROXY_PROBE_UNKNOWN_SHOP) : notFound();
  }

  // Resolve the tenant from the shop domain, then verify the request really is
  // Shopify proxying for THAT store, using that store's own secret.
  const integration = await resolveShopifyIntegrationByShop(shop);
  if (!integration?.api_secret) {
    return isProbe ? probeResponse(PROXY_PROBE_UNKNOWN_SHOP) : notFound();
  }
  if (!verifyAppProxySignature(params, integration.api_secret)) {
    return isProbe ? probeResponse(PROXY_PROBE_BAD_SIGNATURE) : notFound();
  }
  // Verified — and the probe carries no cart, so it stops here without touching
  // the attempts table.
  if (isProbe) return probeResponse(PROXY_PROBE_OK);

  const admin = createAdminClient();
  // Law #1: scope by the org resolved from the VERIFIED shop, never by token
  // alone — a token leaked across tenants must not resolve another org's cart.
  const { data: attempt } = await admin
    .from("shopify_recovery_attempts")
    .select("id, recovery_url, offer_code, clicked_at")
    .eq("organisation_id", integration.organisation_id)
    .eq("short_token", token)
    .maybeSingle<AttemptRow>();

  if (!attempt?.recovery_url) return notFound();

  const destination = buildCheckoutLink(attempt.recovery_url, attempt.offer_code);
  if (!destination) return notFound();

  // Attribution: first click only. Best-effort — a failed write must never cost
  // the shopper their checkout, so it can't block the response.
  if (!attempt.clicked_at) {
    const { error } = await admin
      .from("shopify_recovery_attempts")
      .update({ clicked_at: new Date().toISOString() })
      .eq("id", attempt.id)
      .is("clicked_at", null);
    if (error) {
      logSkeloError("SHOPIFY", "Failed to record recovery link click", {
        cause: error,
        attemptId: attempt.id,
        organisationId: integration.organisation_id,
      });
    }
  }

  return new NextResponse(redirectPage(destination), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Shopify strips Cache-Control from proxied responses; it still applies
      // to a direct hit on this origin. The page is per-shopper — never cache.
      "Cache-Control": "no-store",
    },
  });
}
