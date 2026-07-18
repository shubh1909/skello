import { describe, expect, it } from "vitest";

import {
  PHONE_ATTRIBUTION_WINDOW_MS,
  selectPhoneConversion,
  type PhoneCandidate,
} from "@/lib/shopify/recovery";

const ORDER = Date.parse("2026-07-17T13:10:00Z");

function cand(over: Partial<PhoneCandidate> & { id: string }): PhoneCandidate {
  return {
    status: "succeeded",
    created_at: "2026-07-17T12:22:00Z",
    converted_at: null,
    ...over,
  };
}

describe("selectPhoneConversion — the real GoKwik case", () => {
  // Two connected attempts, same phone, 7 min apart; one order lands after both.
  // Must credit exactly ONE (revenue sums cart_total over every converted row),
  // and prefer the most recent connected cart.
  const older = cand({ id: "a-1215", created_at: "2026-07-17T12:15:00Z" });
  const newer = cand({ id: "a-1222", created_at: "2026-07-17T12:22:00Z" });

  it("credits exactly one attempt, not both (no double-count)", () => {
    const plan = selectPhoneConversion([older, newer], ORDER, PHONE_ATTRIBUTION_WINDOW_MS);
    expect(plan.creditId).toBe("a-1222");
  });

  it("credits the most recent connected cart", () => {
    const plan = selectPhoneConversion([newer, older], ORDER, PHONE_ATTRIBUTION_WINDOW_MS);
    expect(plan.creditId).toBe("a-1222");
  });

  it("has nothing to cancel — both already succeeded (not live)", () => {
    const plan = selectPhoneConversion([older, newer], ORDER, PHONE_ATTRIBUTION_WINDOW_MS);
    expect(plan.cancelIds).toEqual([]);
  });
});

describe("selectPhoneConversion — attribution preference", () => {
  it("prefers a CONNECTED attempt over a more-recent unconnected one", () => {
    // Crediting the pending one instead would lose attribution (no connected
    // call → organic), undercounting our ROI.
    const connected = cand({
      id: "connected",
      status: "succeeded",
      created_at: "2026-07-17T12:00:00Z",
    });
    const pendingLater = cand({
      id: "pending",
      status: "pending",
      created_at: "2026-07-17T12:30:00Z",
    });
    const plan = selectPhoneConversion(
      [connected, pendingLater],
      ORDER,
      PHONE_ATTRIBUTION_WINDOW_MS,
    );
    expect(plan.creditId).toBe("connected");
  });

  it("still stops outreach on the live attempt it did NOT credit", () => {
    const connected = cand({ id: "connected", status: "succeeded" });
    const pending = cand({
      id: "pending",
      status: "pending",
      created_at: "2026-07-17T12:05:00Z",
    });
    const plan = selectPhoneConversion([connected, pending], ORDER, PHONE_ATTRIBUTION_WINDOW_MS);
    expect(plan.creditId).toBe("connected");
    expect(plan.cancelIds).toEqual(["pending"]); // never call a buyer again
  });
});

describe("selectPhoneConversion — time bound", () => {
  it("ignores an attempt older than the window (unrelated later purchase)", () => {
    const stale = cand({
      id: "stale",
      created_at: "2026-07-01T10:00:00Z", // 16 days before the order
    });
    const plan = selectPhoneConversion([stale], ORDER, PHONE_ATTRIBUTION_WINDOW_MS);
    expect(plan).toEqual({ creditId: null, cancelIds: [] });
  });

  it("ignores an attempt created well AFTER the order (a later, different cart)", () => {
    const future = cand({
      id: "future",
      created_at: "2026-07-17T16:00:00Z", // ~3h after the order
    });
    const plan = selectPhoneConversion([future], ORDER, PHONE_ATTRIBUTION_WINDOW_MS);
    expect(plan.creditId).toBeNull();
  });

  it("allows a small forward skew (attempt slightly after the order timestamp)", () => {
    const skew = cand({
      id: "skew",
      created_at: "2026-07-17T13:40:00Z", // 30 min after — within grace
    });
    const plan = selectPhoneConversion([skew], ORDER, PHONE_ATTRIBUTION_WINDOW_MS);
    expect(plan.creditId).toBe("skew");
  });

  it("skips a candidate already converted", () => {
    const done = cand({ id: "done", converted_at: "2026-07-17T13:00:00Z" });
    const plan = selectPhoneConversion([done], ORDER, PHONE_ATTRIBUTION_WINDOW_MS);
    expect(plan).toEqual({ creditId: null, cancelIds: [] });
  });

  it("returns an empty plan for no candidates", () => {
    expect(selectPhoneConversion([], ORDER, PHONE_ATTRIBUTION_WINDOW_MS)).toEqual({
      creditId: null,
      cancelIds: [],
    });
  });
});
