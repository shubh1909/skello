import { describe, expect, it } from "vitest";

import { coerceToE164 } from "@/lib/phone";
import { dialCodeForCountry } from "@/lib/phone-countries";

describe("dialCodeForCountry", () => {
  it("maps ISO-2 codes", () => {
    expect(dialCodeForCountry("AE")).toBe("971");
    expect(dialCodeForCountry("IN")).toBe("91");
    expect(dialCodeForCountry("GB")).toBe("44");
    expect(dialCodeForCountry("SG")).toBe("65");
  });

  it("is case- and whitespace-tolerant, because payloads are", () => {
    expect(dialCodeForCountry("ae")).toBe("971");
    expect(dialCodeForCountry(" Ae ")).toBe("971");
  });

  // NANP: one calling code across many countries; the area code disambiguates.
  it("maps every NANP country to 1", () => {
    for (const iso of ["US", "CA", "PR", "JM"]) {
      expect(dialCodeForCountry(iso)).toBe("1");
    }
  });

  it("accepts a value that is already a dial code", () => {
    expect(dialCodeForCountry("971")).toBe("971");
    expect(dialCodeForCountry("+971")).toBe("971");
  });

  /**
   * The safety property. Falling back to the default market here would turn a
   * Vietnamese number into an Indian-looking one — a number that dials
   * *someone*, just not the customer. Null keeps the caller on the skip path,
   * which is recoverable.
   */
  it("returns null for anything it doesn't know, never a default", () => {
    expect(dialCodeForCountry("ZZ")).toBeNull();
    expect(dialCodeForCountry("XYZ")).toBeNull();
    expect(dialCodeForCountry("")).toBeNull();
    expect(dialCodeForCountry(null)).toBeNull();
    expect(dialCodeForCountry(undefined)).toBeNull();
  });
});

describe("country code + coercion, end to end", () => {
  // The production failure: a UAE mobile that used to become "+563836325".
  it("renders the UAE number that started all this", () => {
    const dial = dialCodeForCountry("AE");
    expect(coerceToE164("0563836325", dial)).toBe("+971563836325");
  });

  it("still refuses when the payload carried no country", () => {
    expect(coerceToE164("0563836325", dialCodeForCountry(null))).toBeNull();
  });

  it("does not disturb the default market", () => {
    expect(coerceToE164("07795122839", dialCodeForCountry("IN"))).toBe(
      "+917795122839",
    );
    // …with or without the country being supplied.
    expect(coerceToE164("07795122839")).toBe("+917795122839");
  });

  it("leaves an already-international number alone whatever the country says", () => {
    expect(coerceToE164("+919876543210", dialCodeForCountry("AE"))).toBe(
      "+919876543210",
    );
  });
});
