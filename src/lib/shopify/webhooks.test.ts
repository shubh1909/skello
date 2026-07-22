import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  normalizeAbandonedCheckout,
  orderRecoveryKeys,
  verifyWebhookHmac,
} from "@/lib/shopify/webhooks";

const SECRET = "shpss_test_secret";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

describe("verifyWebhookHmac", () => {
  const body = JSON.stringify({ token: "abc", total_price: "100.00" });

  it("accepts a correctly-signed body", () => {
    expect(verifyWebhookHmac(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyWebhookHmac(body + " ", sign(body), SECRET)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(verifyWebhookHmac(body, sign(body, "other"), SECRET)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyWebhookHmac(body, null, SECRET)).toBe(false);
  });
});

describe("normalizeAbandonedCheckout", () => {
  it("pulls phone, name, total, items and consent from a checkout payload", () => {
    const result = normalizeAbandonedCheckout({
      token: "chk_123",
      email: "a@b.com",
      total_price: "129.50",
      presentment_currency: "INR",
      abandoned_checkout_url: "https://store.myshopify.com/recover/1",
      buyer_accepts_marketing: true,
      customer: { first_name: "Asha", last_name: "Rao", phone: "+919812345678" },
      line_items: [
        { title: "Kurta", quantity: 2, price: "40.00" },
        { title: "Scarf", quantity: 1, line_price: "49.50" },
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.checkoutToken).toBe("chk_123");
    expect(result!.phone).toBe("+919812345678");
    expect(result!.customerName).toBe("Asha Rao");
    expect(result!.cartTotal).toBe(129.5);
    expect(result!.currency).toBe("INR");
    expect(result!.marketingConsent).toBe(true);
    // lineValue prefers line_price, else unit price × quantity (used to rank).
    expect(result!.lineItems).toEqual([
      { title: "Kurta", quantity: 2, lineValue: 80 },
      { title: "Scarf", quantity: 1, lineValue: 49.5 },
    ]);
  });

  it("falls back to shipping phone and SMS consent", () => {
    const result = normalizeAbandonedCheckout({
      token: "chk_2",
      shipping_address: { phone: "+910000000000", name: "Walk In" },
      customer: { sms_marketing_consent: { state: "subscribed" } },
    });
    expect(result!.phone).toBe("+910000000000");
    expect(result!.customerName).toBe("Walk In");
    expect(result!.marketingConsent).toBe(true);
  });

  it("treats no opt-in as no consent, and missing phone as null", () => {
    const result = normalizeAbandonedCheckout({ token: "chk_3" });
    expect(result!.phone).toBeNull();
    expect(result!.marketingConsent).toBe(false);
  });

  it("returns null without a checkout token", () => {
    expect(normalizeAbandonedCheckout({ total_price: "10" })).toBeNull();
    expect(normalizeAbandonedCheckout(null)).toBeNull();
  });
});

describe("normalizeAbandonedCheckout — cart token", () => {
  it("captures cart_token when present, null when absent", () => {
    expect(
      normalizeAbandonedCheckout({ token: "chk_1", cart_token: "cart_9" })!
        .cartToken,
    ).toBe("cart_9");
    expect(normalizeAbandonedCheckout({ token: "chk_1" })!.cartToken).toBeNull();
  });
});

describe("orderRecoveryKeys", () => {
  it("reads checkout_token, cart_token, buyer phone and order time", () => {
    expect(
      orderRecoveryKeys({
        id: 5544332211,
        checkout_token: "chk_123",
        cart_token: "cart_9",
        phone: "+919962004406",
        created_at: "2026-07-17T13:10:00Z",
      }),
    ).toEqual({
      orderId: "5544332211",
      checkoutToken: "chk_123",
      cartToken: "cart_9",
      phone: "+919962004406",
      orderCreatedAt: "2026-07-17T13:10:00Z",
      orderNumber: null,
      orderTotal: null,
      orderCurrency: null,
    });
  });

  // Revenue reads this. cart_total is the PRE-discount snapshot taken at
  // abandonment, so with an offer running it overstates every recovery.
  it("reads what the shopper actually paid, preferring the current total", () => {
    const keys = orderRecoveryKeys({
      id: 1,
      name: "#1046",
      total_price: "2649.00",
      current_total_price: "2119.20", // after GRAB20
      presentment_currency: "INR",
    });
    expect(keys.orderTotal).toBe(2119.2);
    expect(keys.orderNumber).toBe("#1046");
    expect(keys.orderCurrency).toBe("INR");
  });

  it("falls back to total_price when there is no current total", () => {
    expect(orderRecoveryKeys({ id: 1, total_price: "2649.00" }).orderTotal).toBe(
      2649,
    );
  });

  it("builds an order name from the numeric order_number when name is absent", () => {
    expect(orderRecoveryKeys({ id: 1, order_number: 1046 }).orderNumber).toBe(
      "#1046",
    );
  });

  // REST sends `id` as a NUMBER; it keys the order ledger, so it must normalise
  // to text or redelivery would insert a second row and settle twice.
  it("normalises a numeric order id to text", () => {
    expect(orderRecoveryKeys({ id: 42 }).orderId).toBe("42");
    expect(orderRecoveryKeys({ id: "42" }).orderId).toBe("42");
  });

  // GoKwik's real shape: no tokens at all, phone in the native fields.
  it("handles a tokenless (GoKwik) order — phone only", () => {
    expect(
      orderRecoveryKeys({
        id: 998877,
        customer: { phone: "+917990664995" },
        created_at: "2026-07-17T13:10:56Z",
      }),
    ).toEqual({
      orderId: "998877",
      checkoutToken: null,
      cartToken: null,
      phone: "+917990664995",
      orderCreatedAt: "2026-07-17T13:10:56Z",
      orderNumber: null,
      orderTotal: null,
      orderCurrency: null,
    });
  });

  it("nulls every key when absent", () => {
    expect(orderRecoveryKeys({})).toEqual({
      orderId: null,
      checkoutToken: null,
      cartToken: null,
      phone: null,
      orderCreatedAt: null,
      orderNumber: null,
      orderTotal: null,
      orderCurrency: null,
    });
  });
});

describe("normalizeAbandonedCheckout — completed checkouts", () => {
  // Shopify fires checkouts/update on COMPLETION too. Scheduling from one would
  // create a pending row for a shopper who has already paid, and then dial them.
  it("refuses a checkout that already completed", () => {
    expect(
      normalizeAbandonedCheckout({
        token: "chk_1",
        phone: "+919962004406",
        completed_at: "2026-07-17T13:10:00Z",
      }),
    ).toBeNull();
  });

  it("still accepts one that has not completed", () => {
    expect(
      normalizeAbandonedCheckout({
        token: "chk_1",
        phone: "+919962004406",
        completed_at: null,
      }),
    ).not.toBeNull();
  });
});
