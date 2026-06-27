import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  isValidShopDomain,
  signOAuthState,
  verifyOAuthHmac,
  verifyOAuthState,
  type OAuthState,
} from "@/lib/shopify/oauth";

const SECRET = "shpss_test_secret";

// Build the query string Shopify signs (every param except hmac, sorted, joined
// key=value with &) and attach a valid hmac — mirrors the callback.
function signedParams(
  fields: Record<string, string>,
  secret = SECRET,
): URLSearchParams {
  const message = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const hmac = createHmac("sha256", secret).update(message).digest("hex");
  return new URLSearchParams({ ...fields, hmac });
}

describe("isValidShopDomain", () => {
  it("accepts a real myshopify domain", () => {
    expect(isValidShopDomain("teststore.myshopify.com")).toBe(true);
    expect(isValidShopDomain("my-store-123.myshopify.com")).toBe(true);
  });

  it("rejects anything that isn't *.myshopify.com", () => {
    expect(isValidShopDomain("evil.com")).toBe(false);
    expect(isValidShopDomain("teststore.myshopify.com.evil.com")).toBe(false);
    expect(isValidShopDomain("myshopify.com")).toBe(false);
    expect(isValidShopDomain(null)).toBe(false);
    expect(isValidShopDomain(undefined)).toBe(false);
    expect(isValidShopDomain("")).toBe(false);
  });
});

describe("verifyOAuthHmac", () => {
  const fields = {
    code: "abc123",
    shop: "teststore.myshopify.com",
    state: "nonce123",
    timestamp: "1700000000",
  };

  it("accepts a correctly-signed callback", () => {
    expect(verifyOAuthHmac(signedParams(fields), SECRET)).toBe(true);
  });

  it("rejects a tampered param", () => {
    const params = signedParams(fields);
    params.set("shop", "attacker.myshopify.com"); // hmac no longer matches
    expect(verifyOAuthHmac(params, SECRET)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(verifyOAuthHmac(signedParams(fields), "wrong_secret")).toBe(false);
  });

  it("rejects when hmac is missing", () => {
    expect(verifyOAuthHmac(new URLSearchParams(fields), SECRET)).toBe(false);
  });
});

describe("signOAuthState / verifyOAuthState", () => {
  const payload: OAuthState = {
    state: "nonce123",
    organisationId: "11111111-1111-1111-1111-111111111111",
    shop: "teststore.myshopify.com",
    ts: Date.now(),
  };

  it("round-trips a freshly-signed cookie", () => {
    const cookie = signOAuthState(payload, SECRET);
    expect(verifyOAuthState(cookie, SECRET)).toEqual(payload);
  });

  it("rejects a tampered payload", () => {
    const cookie = signOAuthState(payload, SECRET);
    const [data] = cookie.split(".");
    const forged = `${data}.deadbeef`;
    expect(verifyOAuthState(forged, SECRET)).toBeNull();
  });

  it("rejects a wrong secret", () => {
    const cookie = signOAuthState(payload, SECRET);
    expect(verifyOAuthState(cookie, "wrong_secret")).toBeNull();
  });

  it("rejects an expired cookie", () => {
    const stale = signOAuthState(
      { ...payload, ts: Date.now() - 11 * 60 * 1000 }, // older than the 10-min TTL
      SECRET,
    );
    expect(verifyOAuthState(stale, SECRET)).toBeNull();
  });

  it("rejects undefined / malformed input", () => {
    expect(verifyOAuthState(undefined, SECRET)).toBeNull();
    expect(verifyOAuthState("not-a-valid-cookie", SECRET)).toBeNull();
  });
});
