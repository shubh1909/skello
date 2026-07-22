import { describe, expect, it } from "vitest";

import {
  ABANDONMENT_THRESHOLD_MINUTES,
  PHONE_ATTRIBUTION_WINDOW_MS,
  convertPatch,
  planOrderSettlement,
  type SettleCandidate,
} from "@/lib/shopify/recovery";

const NOW = "2026-07-17T13:11:00Z";
const ORDER = Date.parse("2026-07-17T13:10:00Z");
const ABANDON_MS = ABANDONMENT_THRESHOLD_MINUTES * 60_000;

function attempt(over: Record<string, unknown> = {}) {
  return {
    id: "a-1",
    status: "succeeded",
    whatsapp_status: "sent",
    converted_at: null,
    phone: "+917990664995",
    created_at: "2026-07-17T12:22:00Z",
    ...over,
  } as Parameters<typeof convertPatch>[0];
}

const SETTLED = {
  match: "token",
  outcome: "recovered_by_us",
  firstContactAt: "2026-07-17T12:40:00Z",
} as const;

describe("convertPatch — stamps the verdict once", () => {
  it("records how the order matched and what it was worth to us", () => {
    expect(convertPatch(attempt(), NOW, SETTLED)).toMatchObject({
      converted_at: NOW,
      conversion_match: "token",
      recovery_outcome: "recovered_by_us",
      first_contact_at: "2026-07-17T12:40:00Z",
    });
  });

  it("does NOT overwrite the verdict on an already-converted row", () => {
    // A re-delivered orders/* webhook must not rewrite the original verdict.
    const patch = convertPatch(
      attempt({ converted_at: "2026-07-17T13:00:00Z" }),
      NOW,
      SETTLED,
    );
    expect(patch.converted_at).toBe("2026-07-17T13:00:00Z");
    expect(patch.conversion_match).toBeUndefined();
    expect(patch.recovery_outcome).toBeUndefined();
  });

  it("stops live outreach on both channels when converting", () => {
    const patch = convertPatch(
      attempt({ status: "pending", whatsapp_status: "pending" }),
      NOW,
      SETTLED,
    );
    expect(patch.status).toBe("canceled");
    expect(patch.whatsapp_status).toBe("canceled");
  });
});

function cand(over: Partial<SettleCandidate> & { id: string }): SettleCandidate {
  return {
    status: "succeeded",
    created_at: "2026-07-17T12:22:00Z",
    converted_at: null,
    connected_at: null,
    whatsapp_sent_at: null,
    matchedByToken: false,
    ...over,
  };
}

function plan(candidates: SettleCandidate[], orderMs = ORDER) {
  return planOrderSettlement(
    candidates,
    orderMs,
    PHONE_ATTRIBUTION_WINDOW_MS,
    ABANDON_MS,
  );
}

describe("planOrderSettlement — the re-checkout case that lost recoveries", () => {
  // The real 21 Jul failure: shopper abandons at 10:38, re-enters checkout at
  // 10:52, pays at 10:54. The order names ONLY the young session. The old code
  // returned early on that token match, so the 10:38 cart stayed live and we
  // called them at 11:34 — 40 minutes after they had already paid.
  const orderMs = Date.parse("2026-07-21T10:54:00Z");
  const worked = cand({
    id: "cart-a",
    status: "pending",
    created_at: "2026-07-21T10:38:00Z",
  });
  const reCheckout = cand({
    id: "cart-b",
    status: "pending",
    created_at: "2026-07-21T10:52:00Z",
    matchedByToken: true,
  });

  it("stops outreach on the sibling the order did NOT name", () => {
    expect(plan([worked, reCheckout], orderMs).cancelIds).toContain("cart-a");
  });

  it("credits the token-matched cart — it is the one that became the order", () => {
    const p = plan([worked, reCheckout], orderMs);
    expect(p.creditId).toBe("cart-b");
    expect(p.match).toBe("token");
  });

  it("labels it organic, not ours — we had not reached them yet", () => {
    const p = plan([worked, reCheckout], orderMs);
    expect(p.outcome).toBe("recovered_organic");
    expect(p.firstContactAt).toBeNull();
  });
});

describe("planOrderSettlement — the outcome label", () => {
  it("is recovered_by_us when we reached the buyer before the order", () => {
    const p = plan([
      cand({
        id: "a",
        created_at: "2026-07-17T12:00:00Z",
        connected_at: "2026-07-17T12:40:00Z",
      }),
    ]);
    expect(p.outcome).toBe("recovered_by_us");
    expect(p.firstContactAt).toBe("2026-07-17T12:40:00Z");
  });

  it("credits a WhatsApp-only recovery on a FAILED cart", () => {
    // Voice exhausted without connecting (status 'failed') — which is exactly
    // when the WhatsApp fallback fires. The old phone net filtered `failed` out,
    // so the channel that did the recovering could never be credited.
    const p = plan([
      cand({
        id: "wa",
        status: "failed",
        created_at: "2026-07-17T09:00:00Z",
        whatsapp_sent_at: "2026-07-17T09:30:00Z",
      }),
    ]);
    expect(p.creditId).toBe("wa");
    expect(p.outcome).toBe("recovered_by_us");
    expect(p.match).toBe("phone");
  });

  it("takes the EARLIEST touch across the buyer's carts as first contact", () => {
    const p = plan([
      cand({ id: "later", connected_at: "2026-07-17T12:50:00Z" }),
      cand({
        id: "earlier",
        created_at: "2026-07-17T11:00:00Z",
        whatsapp_sent_at: "2026-07-17T11:30:00Z",
      }),
    ]);
    expect(p.firstContactAt).toBe("2026-07-17T11:30:00Z");
  });

  it("ignores a touch that happened AFTER the order", () => {
    // Contact must PRECEDE the purchase to have caused it.
    const p = plan([
      cand({
        id: "late",
        created_at: "2026-07-17T12:00:00Z",
        connected_at: "2026-07-17T13:40:00Z", // 30 min after the order
      }),
    ]);
    expect(p.outcome).toBe("recovered_organic");
    expect(p.firstContactAt).toBeNull();
  });

  it("is instant_sale when the buyer never abandoned", () => {
    expect(
      plan([cand({ id: "fast", created_at: "2026-07-17T13:05:00Z" })]).outcome,
    ).toBe("instant_sale");
  });

  it("uses the buyer's OLDEST cart to judge abandonment", () => {
    // A young re-checkout beside a genuinely aged cart is not an instant sale —
    // the buyer HAD abandoned, they just returned through a new session.
    const p = plan([
      cand({ id: "old", created_at: "2026-07-17T12:00:00Z" }),
      cand({
        id: "young",
        created_at: "2026-07-17T13:08:00Z",
        matchedByToken: true,
      }),
    ]);
    expect(p.outcome).toBe("recovered_organic");
  });
});

describe("planOrderSettlement — credit selection", () => {
  it("credits exactly one cart (revenue sums cart_total across converted rows)", () => {
    const p = plan([
      cand({ id: "a-1215", created_at: "2026-07-17T12:15:00Z" }),
      cand({ id: "a-1222", created_at: "2026-07-17T12:22:00Z" }),
    ]);
    expect(p.creditId).toBe("a-1222");
  });

  it("prefers a cart we worked over a more-recent untouched one", () => {
    const p = plan([
      cand({
        id: "worked",
        created_at: "2026-07-17T12:00:00Z",
        connected_at: "2026-07-17T12:30:00Z",
      }),
      cand({ id: "untouched", created_at: "2026-07-17T12:50:00Z" }),
    ]);
    expect(p.creditId).toBe("worked");
  });

  it("still stops outreach on the live cart it did NOT credit", () => {
    const p = plan([
      cand({ id: "connected", connected_at: "2026-07-17T12:30:00Z" }),
      cand({
        id: "pending",
        status: "pending",
        created_at: "2026-07-17T12:05:00Z",
      }),
    ]);
    expect(p.creditId).toBe("connected");
    expect(p.cancelIds).toEqual(["pending"]); // never call a buyer who paid
  });

  it("cancels a live sibling even when nothing is creditable", () => {
    const p = plan([
      cand({ id: "done", converted_at: "2026-07-17T13:00:00Z" }),
      cand({
        id: "live",
        status: "pending",
        converted_at: "2026-07-17T13:00:00Z",
      }),
    ]);
    expect(p.creditId).toBeNull();
    expect(p.cancelIds).toEqual(["live"]);
  });
});

describe("planOrderSettlement — time bound", () => {
  it("ignores a cart older than the window (unrelated later purchase)", () => {
    expect(plan([cand({ id: "stale", created_at: "2026-07-01T10:00:00Z" })])).toEqual(
      {
        creditId: null,
        match: null,
        outcome: null,
        firstContactAt: null,
        cancelIds: [],
      },
    );
  });

  it("ignores a cart created well AFTER the order (a later, different cart)", () => {
    expect(
      plan([cand({ id: "future", created_at: "2026-07-17T16:00:00Z" })]).creditId,
    ).toBeNull();
  });

  it("allows a small forward skew (cart slightly after the order timestamp)", () => {
    expect(
      plan([cand({ id: "skew", created_at: "2026-07-17T13:40:00Z" })]).creditId,
    ).toBe("skew");
  });

  it("returns an empty plan for no candidates", () => {
    expect(plan([]).creditId).toBeNull();
  });
});
