import { describe, expect, it } from "vitest";

import { humaniseFieldKey } from "./keys";

describe("humaniseFieldKey", () => {
  it("title-cases snake_case", () => {
    expect(humaniseFieldKey("visit_scheduled_at")).toBe("Visit Scheduled At");
  });

  // The clause the six split-on-underscore copies were missing.
  it("splits camelCase and PascalCase", () => {
    expect(humaniseFieldKey("leadIntent")).toBe("Lead Intent");
    expect(humaniseFieldKey("LeadIntent")).toBe("Lead Intent");
    expect(humaniseFieldKey("utmSource2")).toBe("Utm Source2");
  });

  it("handles kebab-case and mixed separators", () => {
    expect(humaniseFieldKey("utm-source")).toBe("Utm Source");
    expect(humaniseFieldKey("order__id")).toBe("Order Id");
    expect(humaniseFieldKey("cart total_value")).toBe("Cart Total Value");
  });

  it("does not produce empty words from stray separators", () => {
    expect(humaniseFieldKey("_leading")).toBe("Leading");
    expect(humaniseFieldKey("trailing_")).toBe("Trailing");
    expect(humaniseFieldKey("")).toBe("");
  });
});
