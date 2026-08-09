import { describe, expect, it } from "vitest";

import {
  parseTriggeredAt,
  readCheckoutToken,
} from "@/lib/shopify/checkout-events";

// Both readers run on a provider payload/header before anything else trusts it.
// A throw here would happen on the request path, BEFORE we ack Shopify — which
// would turn a malformed delivery into a 503 and an endless retry loop.

describe("readCheckoutToken", () => {
  it("reads the token from a checkout payload", () => {
    expect(readCheckoutToken({ token: "abc123" })).toBe("abc123");
  });

  it("trims surrounding whitespace", () => {
    expect(readCheckoutToken({ token: "  abc123  " })).toBe("abc123");
  });

  it("returns null for a blank or whitespace-only token", () => {
    expect(readCheckoutToken({ token: "" })).toBeNull();
    expect(readCheckoutToken({ token: "   " })).toBeNull();
  });

  it("returns null for a non-string token rather than coercing it", () => {
    expect(readCheckoutToken({ token: 12345 })).toBeNull();
    expect(readCheckoutToken({ token: null })).toBeNull();
    expect(readCheckoutToken({ token: { nested: true } })).toBeNull();
  });

  it("survives payloads that aren't objects at all", () => {
    expect(readCheckoutToken(null)).toBeNull();
    expect(readCheckoutToken(undefined)).toBeNull();
    expect(readCheckoutToken("just a string")).toBeNull();
    expect(readCheckoutToken([])).toBeNull();
  });
});

describe("parseTriggeredAt", () => {
  it("normalises Shopify's ISO header to UTC", () => {
    expect(parseTriggeredAt("2026-08-04T06:08:12.000Z")).toBe(
      "2026-08-04T06:08:12.000Z",
    );
  });

  it("preserves the instant when the header carries an offset", () => {
    // 11:38 IST is 06:08 UTC — the lag report compares absolute instants.
    expect(parseTriggeredAt("2026-08-04T11:38:00+05:30")).toBe(
      "2026-08-04T06:08:00.000Z",
    );
  });

  it("returns null for a missing header", () => {
    expect(parseTriggeredAt(null)).toBeNull();
  });

  it("rejects unparseable values instead of storing an Invalid Date", () => {
    expect(parseTriggeredAt("not a date")).toBeNull();
    expect(parseTriggeredAt("")).toBeNull();
  });
});
