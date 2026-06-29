import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  signOAuthState,
  verifyOAuthHmac,
  verifyOAuthState,
  type OAuthState,
} from "@/lib/shopify/oauth";

const SECRET = "shpss_test_secret";

// Build the query string Shopify signs (every param except hmac, sorted, joined
// key=value with &) and attach a valid hex hmac — mirrors the OAuth callback.
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
    params.set("shop", "attacker.myshopify.com");
    expect(verifyOAuthHmac(params, SECRET)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(verifyOAuthHmac(signedParams(fields), "other")).toBe(false);
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
    expect(verifyOAuthState(signOAuthState(payload, SECRET), SECRET)).toEqual(
      payload,
    );
  });

  it("rejects a tampered payload", () => {
    const [data] = signOAuthState(payload, SECRET).split(".");
    expect(verifyOAuthState(`${data}.deadbeef`, SECRET)).toBeNull();
  });

  it("rejects a wrong secret", () => {
    expect(verifyOAuthState(signOAuthState(payload, SECRET), "other")).toBeNull();
  });

  it("rejects an expired cookie", () => {
    const stale = signOAuthState(
      { ...payload, ts: Date.now() - 11 * 60 * 1000 },
      SECRET,
    );
    expect(verifyOAuthState(stale, SECRET)).toBeNull();
  });

  it("rejects undefined / malformed input", () => {
    expect(verifyOAuthState(undefined, SECRET)).toBeNull();
    expect(verifyOAuthState("not-a-cookie", SECRET)).toBeNull();
  });
});
