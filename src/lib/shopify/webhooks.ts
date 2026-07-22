import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { RecoveryCartItem } from "@/types/shopify";

// The webhook topics we subscribe to per store.
//
// orders/paid and orders/updated are BACKSTOPS, not extra work: settlement is
// keyed on the order id, so whichever topic arrives first settles the order and
// the rest collapse into it (see shopify_order_events). They exist because
// orders/create is delivered exactly once and we process it after already
// ack'ing Shopify — if that delivery is lost, nothing else would ever tell us
// the cart converted. orders/updated matters most for COD (the common GoKwik
// case), where an order may never reach `paid` at all.
export const SHOPIFY_WEBHOOK_TOPICS = [
  "checkouts/create",
  "checkouts/update",
  "orders/create",
  "orders/paid",
  "orders/updated",
] as const;

export type ShopifyWebhookTopic = (typeof SHOPIFY_WEBHOOK_TOPICS)[number];

// The order topics that settle a recovery. Kept separate from the list above so
// the route can test membership without caring about subscription order.
export const SHOPIFY_ORDER_TOPICS: readonly string[] = [
  "orders/create",
  "orders/paid",
  "orders/updated",
];

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

// Shopify sends money as a decimal STRING ("2649.00"), but not always — be
// tolerant of both, and reject anything that isn't a finite number.
function numeric(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
  // Shopify's cart token — stable across checkout re-sessions. Stored alongside
  // checkoutToken so a recovered order can be matched back even when its
  // checkout_token diverges (Shop Pay / express / new checkout).
  cartToken: string | null;
  phone: string | null;
  email: string | null;
  customerName: string | null;
  cartTotal: number | null;
  currency: string | null;
  recoveryUrl: string | null;
  lineItems: RecoveryCartItem[];
  marketingConsent: boolean;
  // Shopify's own checkout-created timestamp (ISO, store tz) — the true
  // abandonment time, distinct from when our webhook processed it.
  abandonedAt: string | null;
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

  // Shopify fires checkouts/update on COMPLETION too, with completed_at set. A
  // completed checkout is an order, not an abandoned cart — scheduling from it
  // would create (or revive) a pending row for a shopper who has already paid,
  // and then dial them. The orders/* topics own this checkout from here.
  if (asString(p.completed_at)) return null;

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
    cartToken: asString(p.cart_token),
    phone,
    email: asString(p.email),
    customerName,
    cartTotal: cartTotal !== null && Number.isFinite(cartTotal) ? cartTotal : null,
    currency: asString(p.presentment_currency) ?? asString(p.currency),
    recoveryUrl: asString(p.abandoned_checkout_url),
    lineItems,
    marketingConsent,
    abandonedAt: asString(p.created_at),
  };
}

export interface OrderRecoveryKeys {
  // Shopify's numeric order id as text. The idempotency key for settlement —
  // null only for a malformed payload, which we then refuse to process.
  orderId: string | null;
  checkoutToken: string | null;
  cartToken: string | null;
  phone: string | null;
  // The order's creation time — bounds the phone fallback so a stale attempt
  // isn't credited for an unrelated later purchase.
  orderCreatedAt: string | null;
  // The human order name ("#1046") the merchant recognises.
  orderNumber: string | null;
  // What the shopper ACTUALLY paid. cart_total is the pre-discount value at
  // abandonment and overstates every discounted recovery, so revenue reads this.
  orderTotal: number | null;
  orderCurrency: string | null;
}

// Pull every identifier an order can be matched back to its abandoned cart by.
// `checkout_token` historically equals the checkouts/* `token`, but diverges for
// express / re-sessioned / new-checkout orders — so we ALSO carry `cart_token`
// (Shopify's own recovery-attribution key) and the buyer phone as a last resort.
export function orderRecoveryKeys(payload: unknown): OrderRecoveryKeys {
  const none: OrderRecoveryKeys = {
    orderId: null,
    checkoutToken: null,
    cartToken: null,
    phone: null,
    orderCreatedAt: null,
    orderNumber: null,
    orderTotal: null,
    orderCurrency: null,
  };
  if (!payload || typeof payload !== "object") return none;
  const p = payload as Json;
  const customer = (p.customer as Json | undefined) ?? {};
  const shipping = (p.shipping_address as Json | undefined) ?? {};
  const billing = (p.billing_address as Json | undefined) ?? {};
  // `id` is a number in REST payloads; normalise to text so it keys the ledger.
  const rawId = p.id;
  const orderId =
    typeof rawId === "number" && Number.isFinite(rawId)
      ? String(rawId)
      : asString(rawId);
  // `current_total_price` reflects edits made after the order was placed;
  // `total_price` is the original. Prefer the current figure, fall back.
  const total = numeric(p.current_total_price) ?? numeric(p.total_price);
  return {
    orderId,
    checkoutToken: asString(p.checkout_token),
    cartToken: asString(p.cart_token),
    phone: firstPhone(p.phone, customer.phone, shipping.phone, billing.phone),
    orderCreatedAt: asString(p.created_at),
    // `name` is "#1046" — what the merchant sees in their admin. `order_number`
    // is the bare 1046 (a NUMBER), used only as a fallback.
    orderNumber:
      asString(p.name) ??
      (typeof p.order_number === "number" ? `#${p.order_number}` : null),
    orderTotal: total,
    orderCurrency:
      asString(p.presentment_currency) ?? asString(p.currency),
  };
}
