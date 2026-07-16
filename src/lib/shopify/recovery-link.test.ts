import { describe, expect, it } from "vitest";

import {
  buildCheckoutLink,
  buildRecoveryVariables,
  type RecoveryVariableSource,
} from "@/lib/shopify/recovery";

const RECOVERY_URL =
  "https://maishalifestyle.com/12345678/checkouts/1a2b3c4d5e6f7a8b/recover?key=abcdef1234567890";

function source(
  overrides: Partial<RecoveryVariableSource> = {},
): RecoveryVariableSource {
  return {
    id: "attempt-1",
    organisation_id: "org-1",
    lead_id: "lead-1",
    customer_name: "Asha Rao",
    cart_total: 5000,
    currency: "INR",
    recovery_url: RECOVERY_URL,
    short_token: "aB3xK9pQ12zY",
    cart_items: [{ title: "Diamond Ring", quantity: 1, lineValue: 5000 }],
    offer_label: "20% off your order",
    offer_code: "COMEBACK20",
    offer_code_spoken: "comeback twenty",
    offer_discount_value: 20,
    offer_discount_kind: "percentage",
    ...overrides,
  };
}

describe("buildCheckoutLink", () => {
  it("wraps the recovery URL in Shopify's discount route, preserving the key", () => {
    const link = buildCheckoutLink(RECOVERY_URL, "COMEBACK20");
    expect(link).toBe(
      "https://maishalifestyle.com/discount/COMEBACK20" +
        "?redirect=%2F12345678%2Fcheckouts%2F1a2b3c4d5e6f7a8b%2Frecover%3Fkey%3Dabcdef1234567890",
    );
    // The `key` is what restores the cart server-side (cross-device); losing it
    // in the encoding would silently break recovery for anyone not on the
    // original browser.
    expect(decodeURIComponent(link)).toContain("key=abcdef1234567890");
  });

  it("returns the bare recovery URL when there is no offer", () => {
    expect(buildCheckoutLink(RECOVERY_URL, null)).toBe(RECOVERY_URL);
  });

  it("returns empty string when there is no recovery URL", () => {
    expect(buildCheckoutLink(null, "COMEBACK20")).toBe("");
  });

  it("falls back to the raw value when the URL is unparseable", () => {
    expect(buildCheckoutLink("not-a-url", "COMEBACK20")).toBe("not-a-url");
  });
});

describe("buildRecoveryVariables — discount_link", () => {
  it("sends the SHORT link on the store's own domain", () => {
    const vars = buildRecoveryVariables(source());
    expect(vars.discount_link).toBe(
      "https://maishalifestyle.com/apps/skelo/r/aB3xK9pQ12zY",
    );
  });

  it("never leaks our own app domain to the shopper", () => {
    const vars = buildRecoveryVariables(source());
    expect(String(vars.discount_link)).not.toContain("skelo.team");
  });

  it("falls back to the long checkout link when the row has no short token", () => {
    const vars = buildRecoveryVariables(source({ short_token: null }));
    expect(vars.discount_link).toBe(buildCheckoutLink(RECOVERY_URL, "COMEBACK20"));
  });

  it("falls back to the long link when the storefront origin is unknown", () => {
    const vars = buildRecoveryVariables(
      source({ recovery_url: "not-a-url", short_token: "aB3xK9pQ12zY" }),
    );
    expect(vars.discount_link).toBe("not-a-url");
  });

  it("is empty when there is no recovery URL at all", () => {
    const vars = buildRecoveryVariables(
      source({ recovery_url: null, short_token: "aB3xK9pQ12zY" }),
    );
    expect(vars.discount_link).toBe("");
  });

  it("still populates store_name for the coupon_link template", () => {
    expect(buildRecoveryVariables(source()).store_name).toBe(
      "maishalifestyle.com",
    );
  });
});

describe("buildRecoveryVariables — written vs spoken discount code", () => {
  // The whole point of the split: one field can't serve both. The agent needs
  // "comeback twenty" (it garbles alphanumerics); WhatsApp and the checkout link
  // need "COMEBACK20" verbatim or the code isn't redeemable.
  it("gives WhatsApp the EXACT code", () => {
    expect(buildRecoveryVariables(source()).discount_code).toBe("COMEBACK20");
  });

  it("gives the agent the SPOKEN code", () => {
    expect(buildRecoveryVariables(source()).discount_code_spoken).toBe(
      "comeback twenty",
    );
  });

  it("never lets the spoken form leak into the exact code", () => {
    const vars = buildRecoveryVariables(source());
    expect(vars.discount_code).not.toBe(vars.discount_code_spoken);
  });

  it("keeps the spoken form out of the checkout link", () => {
    // A phonetic code in the /discount/ path would 404 the coupon.
    const link = buildCheckoutLink(RECOVERY_URL, "COMEBACK20");
    expect(link).toContain("COMEBACK20");
    expect(link).not.toContain("comeback%20twenty");
  });

  it("falls back to the exact code when no spoken form is set", () => {
    const vars = buildRecoveryVariables(source({ offer_code_spoken: null }));
    expect(vars.discount_code_spoken).toBe("COMEBACK20");
    expect(vars.discount_code).toBe("COMEBACK20");
  });

  it("treats a whitespace-only spoken form as unset", () => {
    const vars = buildRecoveryVariables(source({ offer_code_spoken: "   " }));
    expect(vars.discount_code_spoken).toBe("COMEBACK20");
  });

  it("is empty on both when there is no offer at all", () => {
    const vars = buildRecoveryVariables(
      source({ offer_code: null, offer_code_spoken: null }),
    );
    expect(vars.discount_code).toBe("");
    expect(vars.discount_code_spoken).toBe("");
  });
});

describe("buildRecoveryVariables — coupon_link template contract", () => {
  // The coupon_link layout maps these four positionally ({{1}}..{{4}}). A key
  // missing from this output is sent to Meta as "-", which reads as a broken
  // message rather than a failure — so assert every one is present and non-empty.
  it("emits every variable the coupon_link layout orders", () => {
    const vars = buildRecoveryVariables(source());
    for (const key of ["customer_name", "top_product", "store_name", "discount_link"]) {
      expect(String(vars[key] ?? "")).not.toBe("");
    }
  });

  it("emits every variable the classic layout orders", () => {
    const vars = buildRecoveryVariables(source());
    for (const key of [
      "customer_name",
      "top_product",
      "cart_total",
      "discounted_cart_total",
      "discount_code",
      "recovery_url",
    ]) {
      expect(String(vars[key] ?? "")).not.toBe("");
    }
  });

  it("speaks the customer's first name only", () => {
    expect(buildRecoveryVariables(source()).customer_name).toBe("Asha");
  });
});
