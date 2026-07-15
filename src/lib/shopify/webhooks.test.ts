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
  it("reads checkout_token, cart_token and buyer phone", () => {
    expect(
      orderRecoveryKeys({
        checkout_token: "chk_123",
        cart_token: "cart_9",
        phone: "+919962004406",
      }),
    ).toEqual({
      checkoutToken: "chk_123",
      cartToken: "cart_9",
      phone: "+919962004406",
    });
  });

  it("falls back to customer / shipping phone and nulls when absent", () => {
    expect(
      orderRecoveryKeys({ customer: { phone: "+910000000000" } }),
    ).toEqual({
      checkoutToken: null,
      cartToken: null,
      phone: "+910000000000",
    });
    expect(orderRecoveryKeys({})).toEqual({
      checkoutToken: null,
      cartToken: null,
      phone: null,
    });
  });
});
