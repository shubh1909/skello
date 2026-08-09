import { describe, expect, it } from "vitest";

import {
  applyRecoveryOffer,
  buildRecoveryTemplatePreview,
  layoutRequiresOffer,
  RECOVERY_TEMPLATE_LAYOUTS,
  RECOVERY_TEMPLATE_LAYOUT_VALUES,
  resolveRecoveryTemplateLayout,
} from "@/lib/shopify/recovery-templates";
import type { RecoveryTemplateLayout } from "@/types/shopify";

describe("layout registry", () => {
  it("exposes every layout key as a tuple the Zod schema can consume", () => {
    // The action derives its enum from this; a layout missing here saves as an
    // invalid value error rather than working.
    expect([...RECOVERY_TEMPLATE_LAYOUT_VALUES].sort()).toEqual(
      Object.keys(RECOVERY_TEMPLATE_LAYOUTS).sort(),
    );
  });

  it("falls back to the default for unknown or absent values", () => {
    expect(resolveRecoveryTemplateLayout(null)).toBe("coupon_link");
    expect(resolveRecoveryTemplateLayout(undefined)).toBe("coupon_link");
    expect(resolveRecoveryTemplateLayout("festive_2019")).toBe("coupon_link");
  });

  it("round-trips every known layout", () => {
    for (const key of RECOVERY_TEMPLATE_LAYOUT_VALUES) {
      expect(resolveRecoveryTemplateLayout(key)).toBe(key);
    }
  });

  it("gives every layout a preview body with one marker per variable", () => {
    // A marker gap means the preview silently drops a parameter, so an operator
    // approves copy that reads fine and sends a message missing a value.
    for (const [layout, meta] of Object.entries(RECOVERY_TEMPLATE_LAYOUTS)) {
      meta.variableOrder.forEach((_key, i) => {
        expect(
          meta.previewBody,
          `${layout} preview body has no {{${i + 1}}}`,
        ).toContain(`{{${i + 1}}}`);
      });
      // …and no marker beyond the last parameter, which would render literally.
      expect(meta.previewBody).not.toContain(
        `{{${meta.variableOrder.length + 1}}}`,
      );
    }
  });
});

describe("layoutRequiresOffer", () => {
  it("is true for layouts that quote a coupon or a discounted total", () => {
    expect(layoutRequiresOffer("classic")).toBe(true);
  });

  it("is false for rakhi_offer — the tiers are static template copy", () => {
    // If this flips true, the settings form starts nagging tiered orgs to pick
    // a Shopify discount they deliberately don't have.
    expect(layoutRequiresOffer("rakhi_offer")).toBe(false);
  });

  it("does not count discount_link, which works with no offer at all", () => {
    expect(layoutRequiresOffer("coupon_link")).toBe(false);
  });
});

describe("applyRecoveryOffer", () => {
  it("computes a percentage discount", () => {
    expect(applyRecoveryOffer(5000, 20, "percentage")).toEqual({
      discountAmount: 1000,
      discountedTotal: 4000,
      percentLabel: "20%",
    });
  });

  it("never discounts below zero on a fixed amount larger than the cart", () => {
    const r = applyRecoveryOffer(500, 900, "fixed_amount");
    expect(r.discountAmount).toBe(500);
    expect(r.discountedTotal).toBe(0);
  });

  it("returns nulls with no usable offer", () => {
    expect(applyRecoveryOffer(5000, null, "percentage").discountedTotal).toBe(
      null,
    );
    expect(applyRecoveryOffer(null, 20, "percentage").discountedTotal).toBe(
      null,
    );
    expect(applyRecoveryOffer(5000, 0, "percentage").discountedTotal).toBe(null);
  });
});

describe("buildRecoveryTemplatePreview", () => {
  it("leaves no unsubstituted markers in any layout", () => {
    for (const key of RECOVERY_TEMPLATE_LAYOUT_VALUES) {
      expect(buildRecoveryTemplatePreview(key).body).not.toMatch(/\{\{\d+\}\}/);
    }
  });

  it("numbers params 1..n in the layout's own order", () => {
    const p = buildRecoveryTemplatePreview("rakhi_offer").params;
    expect(p.map((x) => x.position)).toEqual([1, 2, 3, 4]);
    expect(p.map((x) => x.key)).toEqual([
      "customer_name",
      "top_product",
      "cart_total",
      "discount_link",
    ]);
  });

  it("shows the whole Rakhi ladder and the checkout link", () => {
    const { body } = buildRecoveryTemplatePreview("rakhi_offer");
    expect(body).toContain("Buy 1 – Get 15% Off");
    expect(body).toContain("Buy 2 – Get 25% Off");
    expect(body).toContain("Buy 3 – Get 35% Off");
    expect(body).toContain("₹2499");
    expect(body).toContain("/apps/skelo/r/");
  });

  it("never puts a coupon code in the tiered message", () => {
    // The ladder replaces the coupon. Leaking a configured code here would
    // promise a discount the approved body doesn't grant.
    const { body } = buildRecoveryTemplatePreview("rakhi_offer", {
      offerType: "discount_code",
      offerCode: "COMEBACK20",
      discountValue: 20,
      discountKind: "percentage",
    });
    expect(body).not.toContain("COMEBACK20");
  });

  it("uses the operator's live offer in layouts that quote one", () => {
    const { body } = buildRecoveryTemplatePreview("classic", {
      offerType: "discount_code",
      offerCode: "COMEBACK20",
      discountValue: 20,
      discountKind: "percentage",
    });
    expect(body).toContain("COMEBACK20");
    // 2499 sample cart − 20% = 1999.2 → 1999 whole rupees, the same rounding
    // the dispatcher applies.
    expect(body).toContain("₹1999");
  });

  it("shows the un-discounted total when no offer is set", () => {
    const { body } = buildRecoveryTemplatePreview("classic", {
      offerType: "none",
    });
    expect(body).toContain("Cart total: ₹2499");
    expect(body).toContain("Your price today: ₹2499");
  });

  it("renders a blank param as the '-' Meta would receive", () => {
    // sanitizeTemplateParam turns empties into "-" on the wire; the preview must
    // show that, not a collapsed line that looks fine.
    const { params } = buildRecoveryTemplatePreview("classic", {
      offerType: "discount_code",
      offerCode: "   ",
    });
    const code = params.find((p) => p.key === "discount_code");
    expect(code?.value).toBe("YOURCODE");
  });

  it("defaults an unknown layout rather than throwing", () => {
    const p = buildRecoveryTemplatePreview("no_such_layout");
    expect(p.layout).toBe<RecoveryTemplateLayout>("coupon_link");
  });
});
