import { describe, expect, it } from "vitest";

import { coerceToE164, isDialable, resolveE164 } from "@/lib/phone";

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
    // …and the same must hold when the dial code is handed to us explicitly.
    // Trusting a `startsWith` here truncated real Indian mobiles to 10 digits.
    expect(coerceToE164("9112345678", "91")).toBe("+919112345678");
  });

  /**
   * The second production bug, and the reason the country hint is a fallback
   * rather than an authority.
   *
   * `07348061482` is an ordinary Indian mobile. Once the Shopify address's
   * `country_code` was threaded in and treated as authoritative, a cart whose
   * address named another market rendered it under that market's dial code —
   * and the voice provider answered "Only +1 and +91 numbers are allowed". The
   * call was never placed and the WhatsApp never sent.
   */
  describe("a country hint that disagrees with the default market", () => {
    it("keeps a home-market number on the home market", () => {
      expect(coerceToE164("07348061482", "971")).toBe("+917348061482");
      expect(coerceToE164("7348061482", "44")).toBe("+917348061482");
    });

    it("reports the override so the cart can be flagged", () => {
      const r = resolveE164("07348061482", "971");
      expect(r.e164).toBe("+917348061482");
      expect(r.source).toBe("default_market");
      expect(r.hintOverridden).toBe(true);
      expect(r.hint).toBe("971");
    });

    it("is not an override when the hint agrees, or when there is none", () => {
      expect(resolveE164("07348061482", "91").hintOverridden).toBe(false);
      expect(resolveE164("07348061482").hintOverridden).toBe(false);
    });

    // The hint still earns its keep: 9 digits is a length India cannot explain.
    it("still rescues a market the default cannot account for", () => {
      const r = resolveE164("0563836325", "971");
      expect(r.e164).toBe("+971563836325");
      expect(r.source).toBe("hint");
      expect(r.hintOverridden).toBe(false);
    });
  });

  /**
   * E.164 assigns no country code beginning with zero, so a leading zero after
   * a `+` is a trunk prefix somebody typed a plus in front of — not an
   * international number. Honouring the plus emitted a literal `+0…`, which
   * every provider rejects.
   */
  describe("a leading zero is never a country code", () => {
    it("treats +0… as a national number, not an international one", () => {
      expect(coerceToE164("+07348061482")).toBe("+917348061482");
      expect(coerceToE164("+0563836325", "971")).toBe("+971563836325");
    });

    it("never emits a number starting +0", () => {
      for (const raw of ["+07348061482", "07348061482", "0007348061482"]) {
        expect(coerceToE164(raw)?.startsWith("+0")).toBe(false);
      }
    });

    it("refuses a bogus dial code rather than prepending it", () => {
      // "0" is not a calling code. Prepending it produced "+07348061482".
      expect(coerceToE164("7348061482", "0")).toBe("+917348061482");
      // Nor is a four-digit one.
      expect(coerceToE164("563836325", "9710")).toBeNull();
    });
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
