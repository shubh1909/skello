import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  APP_PROXY_PREFIX,
  PROXY_PROBE_TOKEN,
  appProxySignatureMessage,
  buildShortRecoveryLink,
  newShortToken,
  verifyAppProxySignature,
} from "@/lib/shopify/app-proxy";

const SECRET = "shpss_test_secret";

// Sign a query string the way Shopify signs an App Proxy request: sorted
// `key=value` strings joined with NOTHING, HMAC-SHA256 → hex, as `signature`.
function signedParams(
  fields: Record<string, string>,
  secret = SECRET,
): URLSearchParams {
  const message = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("");
  const signature = createHmac("sha256", secret).update(message).digest("hex");
  return new URLSearchParams({ ...fields, signature });
}

describe("appProxySignatureMessage", () => {
  it("joins sorted key=value pairs with NO separator", () => {
    const params = new URLSearchParams({
      shop: "maisha.myshopify.com",
      path_prefix: "/apps/skelo",
      timestamp: "1317327555",
      signature: "ignored",
    });
    expect(appProxySignatureMessage(params)).toBe(
      "path_prefix=/apps/skeloshop=maisha.myshopify.comtimestamp=1317327555",
    );
  });

  // The single most likely mistake: reusing the OAuth scheme (joined with "&"),
  // which fails every proxied request with an opaque 404.
  it("does not use the OAuth '&' separator", () => {
    const message = appProxySignatureMessage(
      new URLSearchParams({ b: "2", a: "1", signature: "x" }),
    );
    expect(message).toBe("a=1b=2");
    expect(message).not.toContain("&");
  });

  it("excludes the signature param from the signed message", () => {
    const message = appProxySignatureMessage(
      new URLSearchParams({ shop: "s.myshopify.com", signature: "deadbeef" }),
    );
    expect(message).toBe("shop=s.myshopify.com");
    expect(message).not.toContain("deadbeef");
  });

  it("joins repeated params with a comma", () => {
    const params = new URLSearchParams();
    params.append("extra", "1");
    params.append("extra", "2");
    params.append("shop", "s.myshopify.com");
    expect(appProxySignatureMessage(params)).toBe(
      "extra=1,2shop=s.myshopify.com",
    );
  });

  it("sorts the rendered strings, not just the keys", () => {
    // "a=z" vs "ab=y": sorting keys gives a, ab; sorting rendered strings gives
    // "a=z" < "ab=y" because '=' (0x3D) < 'b' (0x62). Same order here, but the
    // assertion pins the rendered-string rule Shopify's reference uses.
    const params = new URLSearchParams({ ab: "y", a: "z" });
    expect(appProxySignatureMessage(params)).toBe("a=zab=y");
  });
});

describe("verifyAppProxySignature", () => {
  it("accepts a correctly signed request", () => {
    const params = signedParams({
      shop: "maisha.myshopify.com",
      path_prefix: "/apps/skelo",
      timestamp: "1317327555",
    });
    expect(verifyAppProxySignature(params, SECRET)).toBe(true);
  });

  it("rejects a tampered param", () => {
    const params = signedParams({
      shop: "maisha.myshopify.com",
      path_prefix: "/apps/skelo",
    });
    params.set("shop", "attacker.myshopify.com");
    expect(verifyAppProxySignature(params, SECRET)).toBe(false);
  });

  it("rejects a signature from a different store's secret", () => {
    const params = signedParams(
      { shop: "maisha.myshopify.com" },
      "another_orgs_secret",
    );
    expect(verifyAppProxySignature(params, SECRET)).toBe(false);
  });

  it("rejects a missing signature", () => {
    const params = new URLSearchParams({ shop: "maisha.myshopify.com" });
    expect(verifyAppProxySignature(params, SECRET)).toBe(false);
  });

  it("rejects a signature of the wrong length without throwing", () => {
    // timingSafeEqual throws on length mismatch — the guard must catch it.
    const params = new URLSearchParams({ shop: "s.myshopify.com" });
    params.set("signature", "abc");
    expect(() => verifyAppProxySignature(params, SECRET)).not.toThrow();
    expect(verifyAppProxySignature(params, SECRET)).toBe(false);
  });
});

describe("newShortToken", () => {
  it("mints a 12-char base62 token", () => {
    for (let i = 0; i < 50; i++) {
      expect(newShortToken()).toMatch(/^[0-9A-Za-z]{12}$/);
    }
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 500 }, () => newShortToken()));
    expect(seen.size).toBe(500);
  });
});

describe("PROXY_PROBE_TOKEN", () => {
  // The probe short-circuits the route before the cart lookup, so a token that
  // could collide with a real one would make that shopper's link un-openable.
  it("cannot be produced by newShortToken", () => {
    expect(PROXY_PROBE_TOKEN).not.toMatch(/^[0-9A-Za-z]{12}$/);
  });

  it("contains characters the token alphabet can never emit", () => {
    expect(PROXY_PROBE_TOKEN).toContain("_");
  });

  it("is not 12 chars, so it can't shadow a real token by length alone", () => {
    expect(PROXY_PROBE_TOKEN.length).not.toBe(12);
  });
});

describe("buildShortRecoveryLink", () => {
  it("builds the proxied link on the STORE's origin", () => {
    expect(
      buildShortRecoveryLink("https://maishalifestyle.com", "aB3xK9pQ12zY"),
    ).toBe("https://maishalifestyle.com/apps/skelo/r/aB3xK9pQ12zY");
  });

  it("is far shorter than the long checkout URL it replaces", () => {
    const long =
      "https://maishalifestyle.com/discount/COMEBACK20?redirect=%2F12345678%2Fcheckouts%2F1a2b3c4d5e6f7a8b%2Frecover%3Fkey%3Dabcdef1234567890";
    const short = buildShortRecoveryLink(
      "https://maishalifestyle.com",
      newShortToken(),
    );
    expect(short.length).toBeLessThan(long.length / 2);
  });

  it("uses the configured proxy prefix", () => {
    expect(buildShortRecoveryLink("https://x.com", "tok")).toContain(
      APP_PROXY_PREFIX,
    );
  });
});
