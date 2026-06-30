import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { RecoveryCartItem } from "@/types/shopify";

// The webhook topics we subscribe to per store.
export const SHOPIFY_WEBHOOK_TOPICS = [
  "checkouts/create",
  "checkouts/update",
  "orders/create",
] as const;

export type ShopifyWebhookTopic = (typeof SHOPIFY_WEBHOOK_TOPICS)[number];

/**
 * Verify the HMAC Shopify puts on every webhook. The signature is base64 of
 * HMAC-SHA256 over the RAW request body (NOT the OAuth scheme — that's hex over
 * the sorted query string). Always verify the raw bytes, before JSON.parse.
 */
export function verifyWebhookHmac(
  rawBody: string,
  headerBase64: string | null,
  secret: string,
): boolean {
  if (!headerBase64) return false;
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let sent: Buffer;
  try {
    sent = Buffer.from(headerBase64, "base64");
  } catch {
    return false;
  }
  return digest.length === sent.length && timingSafeEqual(digest, sent);
}

// ---------------------------------------------------------------------------
// Payload extraction. Shopify payloads are large and loosely-typed; we read
// defensively and only pull what cart recovery needs.
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function firstPhone(...candidates: Array<unknown>): string | null {
  for (const c of candidates) {
    const s = asString(c);
    if (s) return s;
  }
  return null;
}

export interface NormalizedCheckout {
  checkoutToken: string;
  phone: string | null;
  email: string | null;
  customerName: string | null;
  cartTotal: number | null;
  currency: string | null;
  recoveryUrl: string | null;
  lineItems: RecoveryCartItem[];
  marketingConsent: boolean;
}

// Pull the abandoned-checkout fields from a checkouts/{create,update} payload.
// Returns null when there's no checkout token to key on.
export function normalizeAbandonedCheckout(
  payload: unknown,
): NormalizedCheckout | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Json;

  const checkoutToken = asString(p.token);
  if (!checkoutToken) return null;

  const customer = (p.customer as Json | undefined) ?? {};
  const shipping = (p.shipping_address as Json | undefined) ?? {};
  const billing = (p.billing_address as Json | undefined) ?? {};

  const phone = firstPhone(
    p.phone,
    customer.phone,
    shipping.phone,
    billing.phone,
  );

  const nameParts = [
    asString(customer.first_name),
    asString(customer.last_name),
  ].filter(Boolean);
  const customerName =
    nameParts.length > 0 ? nameParts.join(" ") : asString(shipping.name);

  const totalRaw = asString(p.total_price);
  const cartTotal = totalRaw !== null ? Number(totalRaw) : null;

  const lineItemsRaw = Array.isArray(p.line_items) ? p.line_items : [];
  const lineItems: RecoveryCartItem[] = lineItemsRaw
    .map((li) => {
      const item = li as Json;
      const title = asString(item.title);
      if (!title) return null;
      const quantity = Number(item.quantity);
      const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
      // `line_price` is price × quantity when present; otherwise derive it from
      // the unit `price`. Either may be a string. Used only to rank items.
      const linePriceRaw = Number(item.line_price);
      const unitPriceRaw = Number(item.price);
      const lineValue = Number.isFinite(linePriceRaw)
        ? linePriceRaw
        : Number.isFinite(unitPriceRaw)
          ? unitPriceRaw * qty
          : 0;
      return { title, quantity: qty, lineValue };
    })
    .filter((x): x is RecoveryCartItem => x !== null);

  // Best-effort consent: explicit checkout marketing opt-in, or an SMS consent
  // object on the customer marked subscribed.
  const smsConsent = customer.sms_marketing_consent as Json | undefined;
  const marketingConsent =
    p.buyer_accepts_marketing === true ||
    asString(smsConsent?.state)?.toLowerCase() === "subscribed";

  return {
    checkoutToken,
    phone,
    email: asString(p.email),
    customerName,
    cartTotal: cartTotal !== null && Number.isFinite(cartTotal) ? cartTotal : null,
    currency: asString(p.presentment_currency) ?? asString(p.currency),
    recoveryUrl: asString(p.abandoned_checkout_url),
    lineItems,
    marketingConsent,
  };
}

// Pull the checkout token an order completed against, so we can cancel/convert
// the matching recovery attempt. Orders/{create} carries checkout_token.
export function orderCheckoutToken(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  return asString((payload as Json).checkout_token);
}
