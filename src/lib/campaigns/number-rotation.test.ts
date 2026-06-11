import { describe, expect, it } from "vitest";

import {
  FALLBACK_NO_NUMBER,
  computeNumberHealth,
  pickHealthyNumber,
  type NumberHealth,
  type PickNumberInput,
} from "@/lib/campaigns/dispatch";

const FLOOR = 40;
const MIN_SAMPLES = 20;

function base(overrides: Partial<PickNumberInput> = {}): PickNumberInput {
  return {
    pool: [],
    singleOverride: null,
    health: new Map(),
    batchUsage: new Map(),
    floorPct: FLOOR,
    minSamples: MIN_SAMPLES,
    allowLeastBad: false,
    ...overrides,
  };
}

function h(dials: number, connects: number): NumberHealth {
  return { dials, connects };
}

describe("pickHealthyNumber — healthy selection", () => {
  it("picks a healthy number and spreads by least load (window dials + batch)", () => {
    const r = pickHealthyNumber(
      base({
        pool: ["+A", "+B"],
        health: new Map([
          ["+A", h(50, 30)], // 60% healthy, 50 dials
          ["+B", h(30, 21)], // 70% healthy, 30 dials → less loaded
        ]),
      }),
    );
    expect(r).toEqual({ kind: "dial", number: "+B", degraded: false });
  });

  it("treats a number with too few samples as healthy (gives it a chance)", () => {
    const r = pickHealthyNumber(
      base({
        pool: ["+A"],
        health: new Map([["+A", h(5, 0)]]), // 0% but only 5 samples → unknown
      }),
    );
    expect(r).toEqual({ kind: "dial", number: "+A", degraded: false });
  });

  it("skips a resting number and uses the healthy one", () => {
    const r = pickHealthyNumber(
      base({
        pool: ["+A", "+B"],
        health: new Map([
          ["+A", h(50, 10)], // 20% < floor → resting
          ["+B", h(50, 30)], // 60% healthy
        ]),
      }),
    );
    expect(r).toEqual({ kind: "dial", number: "+B", degraded: false });
  });

  it("breaks load ties with in-batch usage", () => {
    const r = pickHealthyNumber(
      base({
        pool: ["+A", "+B"],
        health: new Map([
          ["+A", h(30, 20)],
          ["+B", h(30, 20)],
        ]),
        batchUsage: new Map([["+A", 3]]), // A already dialed more this tick
      }),
    );
    expect(r).toEqual({ kind: "dial", number: "+B", degraded: false });
  });
});

describe("pickHealthyNumber — all resting", () => {
  const allResting = {
    pool: ["+A", "+B"],
    health: new Map([
      ["+A", h(50, 10)], // 20%
      ["+B", h(50, 5)], // 10%
    ]),
  };

  it("defers when backoff is not yet exhausted", () => {
    const r = pickHealthyNumber(base({ ...allResting, allowLeastBad: false }));
    expect(r).toEqual({ kind: "defer" });
  });

  it("dials the least-bad (highest connect rate) once backoff is exhausted", () => {
    const r = pickHealthyNumber(base({ ...allResting, allowLeastBad: true }));
    expect(r).toEqual({ kind: "dial", number: "+A", degraded: true });
  });
});

describe("pickHealthyNumber — single-number precedence", () => {
  it("uses the single override when no pool is set", () => {
    const r = pickHealthyNumber(base({ singleOverride: "+S" }));
    expect(r).toEqual({ kind: "dial", number: "+S", degraded: false });
  });

  it("defers a resting single override (no backoff yet)", () => {
    const r = pickHealthyNumber(
      base({
        singleOverride: "+S",
        health: new Map([["+S", h(50, 5)]]), // 10% resting
      }),
    );
    expect(r).toEqual({ kind: "defer" });
  });

  it("least-bad dials the resting single override once backoff is exhausted", () => {
    const r = pickHealthyNumber(
      base({
        singleOverride: "+S",
        health: new Map([["+S", h(50, 5)]]),
        allowLeastBad: true,
      }),
    );
    expect(r).toEqual({ kind: "dial", number: "+S", degraded: true });
  });
});

describe("pickHealthyNumber — nothing configured", () => {
  it("dials with the empty-string sentinel (provider picks)", () => {
    const r = pickHealthyNumber(base({}));
    expect(r).toEqual({
      kind: "dial",
      number: FALLBACK_NO_NUMBER,
      degraded: false,
    });
  });
});

describe("computeNumberHealth", () => {
  const NOW = 1_700_000_000_000;
  const within = new Date(NOW - 5 * 60 * 1000).toISOString(); // 5 min ago
  const old = new Date(NOW - 120 * 60 * 1000).toISOString(); // 2 h ago
  const windowMs = 60 * 60 * 1000; // 1 h

  it("counts dials + connects within the window only", () => {
    const rows = [
      { organisation_id: "o", from_phone: "+A", status: "completed", started_at: within },
      { organisation_id: "o", from_phone: "+A", status: "no_answer", started_at: within },
      { organisation_id: "o", from_phone: "+A", status: "completed", started_at: old }, // excluded
      { organisation_id: "o", from_phone: "+B", status: "completed", started_at: within },
    ];
    const health = computeNumberHealth(rows, windowMs, NOW);
    expect(health.get("+A")).toEqual({ dials: 2, connects: 1 });
    expect(health.get("+B")).toEqual({ dials: 1, connects: 1 });
  });

  it("ignores rows with no caller-ID", () => {
    const rows = [
      { organisation_id: "o", from_phone: null, status: "completed", started_at: within },
    ];
    expect(computeNumberHealth(rows, windowMs, NOW).size).toBe(0);
  });
});
