import { describe, expect, it } from "vitest";

import { isEmptyValue } from "@/lib/format/empty";

describe("isEmptyValue", () => {
  it("treats absent values as empty", () => {
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue(undefined)).toBe(true);
    expect(isEmptyValue("")).toBe(true);
    expect(isEmptyValue("   ")).toBe(true);
    expect(isEmptyValue([])).toBe(true);
    expect(isEmptyValue({})).toBe(true);
  });

  // The whole reason this helper exists rather than a falsy check. A 0 cart
  // value and a declined WhatsApp opt-in are ANSWERS; hiding them turns
  // "they said no" into "we never asked".
  it("does NOT treat 0 or false as empty", () => {
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue(false)).toBe(false);
  });

  it("keeps real values", () => {
    expect(isEmptyValue("Asha")).toBe(false);
    expect(isEmptyValue(2499)).toBe(false);
    expect(isEmptyValue([1])).toBe(false);
    expect(isEmptyValue({ a: 1 })).toBe(false);
  });
});
