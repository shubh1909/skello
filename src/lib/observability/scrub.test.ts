import { describe, expect, it } from "vitest";

import { scrubSentryEvent } from "@/lib/observability/scrub";

describe("scrubSentryEvent", () => {
  it("strips the query string from a Shopify recovery URL (the live checkout key)", () => {
    const url =
      "https://maishalifestyle.com/58193838255/checkouts/ac/hWNEEPEtZjIAWHvOMK1dEFC0/recover?key=330c63614cdf9e02d415bf67c168330c&locale=en-GB";
    const out = scrubSentryEvent({ extra: { note: `open ${url}` } });
    const note = (out.extra as { note: string }).note;
    expect(note).not.toContain("key=");
    expect(note).not.toContain("330c63614cdf9e02d415bf67c168330c");
    expect(note).toContain("/recover?[redacted]");
  });

  it("redacts phone numbers by value, even under an innocuous key", () => {
    const out = scrubSentryEvent({
      extra: { blob: "called +918860780727 and 9876543210 today" },
    });
    const blob = (out.extra as { blob: string }).blob;
    expect(blob).not.toContain("918860780727");
    expect(blob).not.toContain("9876543210");
    expect(blob).toContain("[phone]");
  });

  it("redacts emails and bearer tokens", () => {
    const out = scrubSentryEvent({
      extra: {
        msg: "auth Bearer sk_live_abc123.DEF-456 for user@example.com",
      },
    });
    const msg = (out.extra as { msg: string }).msg;
    expect(msg).toContain("[email]");
    expect(msg).toContain("Bearer [redacted]");
    expect(msg).not.toContain("sk_live_abc123");
  });

  it("blanks sensitive keys regardless of value (incl. header + camelCase variants)", () => {
    const out = scrubSentryEvent({
      request: {
        headers: {
          authorization: "Bearer xyz",
          "x-bolna-signature": "supersecret",
          "content-type": "application/json",
        },
      },
      extra: {
        api_token: "abc",
        customer_name: "Mohit Gupta",
        toNumber: "+918860780727",
        recovery_url: "https://x.com/recover?key=live",
        organisation_id: "01e116ae-5124-46a7-b3a8-f168d113a4a4",
      },
    });
    const headers = (out.request as { headers: Record<string, string> })
      .headers;
    const extra = out.extra as Record<string, string>;
    expect(headers.authorization).toBe("[redacted]");
    expect(headers["x-bolna-signature"]).toBe("[redacted]");
    expect(headers["content-type"]).toBe("application/json"); // non-sensitive kept
    expect(extra.api_token).toBe("[redacted]");
    expect(extra.customer_name).toBe("[redacted]");
    expect(extra.toNumber).toBe("[redacted]"); // camelCase caught by key rule
    expect(extra.recovery_url).toBe("[redacted]");
    // Non-PII ids survive so debugging still works.
    expect(extra.organisation_id).toBe("01e116ae-5124-46a7-b3a8-f168d113a4a4");
  });

  it("keeps useful non-sensitive context (tags, product names, timestamps)", () => {
    const out = scrubSentryEvent({
      tags: { "skelo.tag": "WEBHOOK-INGEST", "skelo.org": "acme" },
      extra: {
        top_product: "Eye See You Tote Bag",
        created_at: "2026-07-08T07:22:16.582080Z",
        item_count: 2,
      },
    });
    expect(out.tags).toEqual({
      "skelo.tag": "WEBHOOK-INGEST",
      "skelo.org": "acme",
    });
    const extra = out.extra as Record<string, unknown>;
    expect(extra.top_product).toBe("Eye See You Tote Bag");
    expect(extra.created_at).toBe("2026-07-08T07:22:16.582080Z"); // not a phone
    expect(extra.item_count).toBe(2);
  });

  it("drops user and server_name wholesale", () => {
    const out = scrubSentryEvent({
      user: { email: "a@b.com", ip_address: "1.2.3.4" },
      server_name: "skeloCrm",
      message: "boom",
    });
    expect(out.user).toBeUndefined();
    expect(out.server_name).toBeUndefined();
    expect(out.message).toBe("boom");
  });

  it("handles circular references without throwing", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => scrubSentryEvent({ extra: circular })).not.toThrow();
  });
});
