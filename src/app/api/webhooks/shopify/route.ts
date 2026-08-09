import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";

import { logSkeloError, warnSkelo } from "@/lib/errors";
import {
  checkRateLimit,
  clientIpFromRequest,
  tooManyRequestsResponse,
} from "@/lib/rate-limit";
import {
  processRecordedCheckoutEvent,
  recordCheckoutEvent,
} from "@/lib/shopify/checkout-events";
import { enqueueCodConfirmation } from "@/lib/shopify/cod-confirmation";
import { resolveShopifyIntegrationByShop } from "@/lib/shopify/integration";
import { recordAndSettleOrder } from "@/lib/shopify/recovery";
import { normalizeShopDomain } from "@/lib/shopify/util";
import {
  SHOPIFY_ORDER_TOPICS,
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

  const isCheckoutTopic =
    topic === "checkouts/create" || topic === "checkouts/update";

  // Durability BEFORE the ack. A 200 tells Shopify to forget this delivery, and
  // everything after() runs somewhere Shopify can no longer hear us fail — so we
  // must have the event on disk first. One insert, a few ms; the 6-8 round trips
  // of scheduling stay off the critical path. If the receipt can't be written we
  // deliberately do NOT ack: 503 hands the delivery back to Shopify's retries.
  let eventId: string | null = null;
  if (isCheckoutTopic) {
    try {
      const recorded = await recordCheckoutEvent({
        integration,
        topic,
        webhookId: request.headers.get("x-shopify-webhook-id"),
        triggeredAtHeader: request.headers.get("x-shopify-triggered-at"),
        payload,
      });
      // Shopify retrying an event we already hold. The original receipt is
      // either processed or queued for the tick — doing it again would be
      // duplicate work on a payload we've already seen.
      if (recorded.duplicate) {
        return NextResponse.json(
          { ok: true, ignored: "duplicate_delivery" },
          { status: 200 },
        );
      }
      eventId = recorded.eventId;
    } catch (err) {
      logSkeloError("SHOPIFY", "Could not record checkout webhook", {
        shop,
        topic,
        cause: err,
      });
      return NextResponse.json(
        { error: "Could not record webhook" },
        { status: 503 },
      );
    }
  }

  // Ack fast; do the real work after responding (Shopify's ~5s deadline).
  after(async () => {
    try {
      if (isCheckoutTopic) {
        // Receipt is already durable — this is the fast path, and the cron tick
        // replays it if anything here dies.
        if (eventId) {
          await processRecordedCheckoutEvent({
            eventId,
            integration,
            topic,
            payload,
          });
        }
      } else if (SHOPIFY_ORDER_TOPICS.includes(topic)) {
        const keys = orderRecoveryKeys(payload);
        // No order id → nothing to key idempotency on. Refuse rather than settle
        // a payload we can't recognise again on redelivery.
        if (!keys.orderId) {
          warnSkelo("SHOPIFY", "Order webhook without an id", { shop, topic });
          return;
        }
        // Two independent consumers of the same order event: cart-recovery
        // settlement and COD-confirmation enqueue. Each is wrapped so one
        // failing can't skip the other — they are separate subsystems.
        try {
          await recordAndSettleOrder({
            organisationId: integration.organisation_id,
            shopDomain: integration.shop_domain,
            topic,
            orderId: keys.orderId,
            checkoutToken: keys.checkoutToken,
            cartToken: keys.cartToken,
            phone: keys.phone,
            orderCreatedAt: keys.orderCreatedAt,
            orderNumber: keys.orderNumber,
            orderTotal: keys.orderTotal,
            orderCurrency: keys.orderCurrency,
          });
        } catch (err) {
          logSkeloError("SHOPIFY", "Order settlement failed", {
            shop,
            topic,
            cause: err,
          });
        }
        try {
          await enqueueCodConfirmation({ integration, payload });
        } catch (err) {
          logSkeloError("SHOPIFY", "COD confirmation enqueue failed", {
            shop,
            topic,
            cause: err,
          });
        }
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
