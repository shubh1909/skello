import { describe, expect, it } from "vitest";

import { coerceToE164 } from "@/lib/phone";

describe("coerceToE164", () => {
  it("adds +91 to a bare 10-digit local number", () => {
    expect(coerceToE164("7795122839")).toBe("+917795122839");
  });

  it("strips a national trunk 0 then adds the country code", () => {
    expect(coerceToE164("07795122839")).toBe("+917795122839");
  });

  it("keeps a number that already has a country code (no +)", () => {
    expect(coerceToE164("917795122839")).toBe("+917795122839");
  });

  it("passes through an already-E.164 number unchanged", () => {
    expect(coerceToE164("+917795122839")).toBe("+917795122839");
  });

  it("never rewrites an international (+) number's country code", () => {
    expect(coerceToE164("+15551234567")).toBe("+15551234567");
  });

  it("strips spaces, dashes, and parens", () => {
    expect(coerceToE164("(779) 512-2839")).toBe("+917795122839");
    expect(coerceToE164("+91 77951 22839")).toBe("+917795122839");
  });

  it("returns null for empty / digitless input", () => {
    expect(coerceToE164(null)).toBeNull();
    expect(coerceToE164("")).toBeNull();
    expect(coerceToE164("abc")).toBeNull();
  });
});
