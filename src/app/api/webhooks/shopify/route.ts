import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";

import { logSkeloError, warnSkelo } from "@/lib/errors";
import {
  checkRateLimit,
  clientIpFromRequest,
  tooManyRequestsResponse,
} from "@/lib/rate-limit";
import { resolveShopifyIntegrationByShop } from "@/lib/shopify/integration";
import {
  cancelRecoveryForOrder,
  scheduleRecoveryFromCheckout,
} from "@/lib/shopify/recovery";
import { normalizeShopDomain } from "@/lib/shopify/util";
import {
  orderRecoveryKeys,
  verifyWebhookHmac,
} from "@/lib/shopify/webhooks";

export const runtime = "nodejs"; // node:crypto + raw body
export const dynamic = "force-dynamic";

// One shared endpoint for every connected store. Tenancy is resolved from the
// shop domain server-side (never the payload), and the HMAC is verified with
// THAT store's own api_secret — so each client's custom app is isolated.
//
//   POST /api/webhooks/shopify
export async function POST(request: NextRequest) {
  const shop = normalizeShopDomain(
    request.headers.get("x-shopify-shop-domain"),
  );
  const topic = request.headers.get("x-shopify-topic");
  if (!shop || !topic) {
    return NextResponse.json({ error: "Missing Shopify headers" }, { status: 400 });
  }

  // Coarse abuse guard, keyed by source IP (Shopify retries aggressively).
  const rl = await checkRateLimit({
    key: `shopify-webhook:ip:${clientIpFromRequest(request)}`,
    windowSeconds: 60,
    max: 6000,
  });
  if (!rl.allowed) return tooManyRequestsResponse(rl.retryAfterSeconds);

  const rawBody = await request.text();

  // Resolve the tenant + its signing secret before trusting anything.
  const integration = await resolveShopifyIntegrationByShop(shop);
  if (!integration || !integration.enabled) {
    // Unknown/disabled store — ack so Shopify doesn't retry forever.
    return NextResponse.json({ ok: true, ignored: "unknown_shop" }, { status: 200 });
  }

  if (
    !verifyWebhookHmac(
      rawBody,
      request.headers.get("x-shopify-hmac-sha256"),
      integration.api_secret,
    )
  ) {
    warnSkelo("SHOPIFY", "Webhook HMAC verification failed", { shop, topic });
    return NextResponse.json({ error: "Invalid HMAC" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Ack fast; do the real work after responding (Shopify's ~5s deadline).
  after(async () => {
    try {
      if (topic === "checkouts/create" || topic === "checkouts/update") {
        await scheduleRecoveryFromCheckout({ integration, payload });
      } else if (topic === "orders/create") {
        await cancelRecoveryForOrder({
          integration,
          ...orderRecoveryKeys(payload),
        });
      }
    } catch (err) {
      logSkeloError("SHOPIFY", "Webhook processing failed", {
        shop,
        topic,
        cause: err,
      });
    }
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
