import { describe, expect, it } from "vitest";

import { coerceToE164, isDialable } from "@/lib/phone";

describe("coerceToE164", () => {
  it("prepends the default country code to a bare national number", () => {
    expect(coerceToE164("7795122839")).toBe("+917795122839");
  });

  it("drops a national trunk prefix before prepending", () => {
    expect(coerceToE164("07795122839")).toBe("+917795122839");
  });

  it("leaves a number that already carries the country code", () => {
    expect(coerceToE164("917795122839")).toBe("+917795122839");
  });

  it("passes through an explicit international number", () => {
    expect(coerceToE164("+917795122839")).toBe("+917795122839");
    expect(coerceToE164("+15551234567")).toBe("+15551234567");
    expect(coerceToE164("+971563836325")).toBe("+971563836325");
  });

  it("ignores punctuation and spacing", () => {
    expect(coerceToE164("(779) 512-2839")).toBe("+917795122839");
    expect(coerceToE164("+91 77951 22839")).toBe("+917795122839");
  });

  it("returns null for empty or non-numeric input", () => {
    expect(coerceToE164(null)).toBeNull();
    expect(coerceToE164("")).toBeNull();
    expect(coerceToE164("abc")).toBeNull();
    expect(coerceToE164("0")).toBeNull();
  });

  /**
   * The production bug. `0563836325` is a UAE mobile; the old rule stripped the
   * trunk zero, found 9 digits rather than 10, prepended nothing, and emitted
   * `+563836325` — which the provider rejected with "invalid WhatsApp number",
   * *after* the send had already cost an attempt.
   */
  describe("a national number from a market we don't have a code for", () => {
    it("refuses rather than inventing a country", () => {
      expect(coerceToE164("0563836325")).toBeNull();
      expect(coerceToE164("563836325")).toBeNull();
      // The exact number from the failed send.
      expect(coerceToE164("193593025")).toBeNull();
    });

    it("renders correctly once the market's dial code is supplied", () => {
      expect(coerceToE164("0563836325", "971")).toBe("+971563836325");
      expect(coerceToE164("563836325", "971")).toBe("+971563836325");
    });

    it("accepts a dial code written with a plus or spaces", () => {
      expect(coerceToE164("0563836325", "+971")).toBe("+971563836325");
    });
  });

  describe("E.164 bounds", () => {
    it("refuses anything too short to dial", () => {
      expect(coerceToE164("12345")).toBeNull();
      expect(coerceToE164("+1234")).toBeNull();
    });

    it("refuses anything past the 15-digit maximum", () => {
      expect(coerceToE164("+1234567890123456")).toBeNull();
    });

    it("accepts the boundary lengths", () => {
      expect(coerceToE164("+12345678")).toBe("+12345678");
      expect(coerceToE164("+123456789012345")).toBe("+123456789012345");
    });
  });

  it("does not prepend a country code to an already-long number", () => {
    // 11 digits, no plus — assumed to carry someone's country code already.
    // Prepending ours would produce a 13-digit fiction.
    expect(coerceToE164("12345678901")).toBe("+12345678901");
  });

  it("does not treat a short number starting with 91 as Indian", () => {
    // "91" + 8 digits is not a valid Indian number (needs 10 subscriber
    // digits), so it must not pass the already-has-country-code branch.
    expect(coerceToE164("9112345678")).toBe("+919112345678");
  });
});

describe("isDialable", () => {
  it("agrees with coerceToE164", () => {
    expect(isDialable("7795122839")).toBe(true);
    expect(isDialable("0563836325")).toBe(false);
    expect(isDialable("0563836325", "971")).toBe(true);
    expect(isDialable(null)).toBe(false);
  });
});
