import { describe, expect, it } from "vitest";

import {
  buildSeries,
  dayBuckets,
  lifetimeBuckets,
  monthBuckets,
  parseRange,
} from "@/lib/analytics/dashboard";

const BUCKETS = ["2026-08-08", "2026-08-09", "2026-08-10"] as const;

/**
 * One row as `dashboard_activity_series` returns it — counts as STRINGS,
 * because Postgres bigint exceeds what a JSON number guarantees and PostgREST
 * serialises it as text. Fixtures use strings on purpose: if the mapping ever
 * stops calling Number(), `+` starts concatenating and these tests catch it.
 */
function bucket(
  b: string,
  v: Partial<{
    calls: number;
    connected: number;
    new_leads: number;
    hot: number;
    warm: number;
    cold: number;
  }> = {},
) {
  return {
    bucket: `${b}T00:00:00Z`,
    calls: String(v.calls ?? 0),
    connected: String(v.connected ?? 0),
    new_leads: String(v.new_leads ?? 0),
    hot: String(v.hot ?? 0),
    warm: String(v.warm ?? 0),
    cold: String(v.cold ?? 0),
  };
}

describe("dayBuckets", () => {
  it("returns `days` consecutive days ending today", () => {
    const now = Date.UTC(2026, 7, 10, 15, 30);
    expect(dayBuckets(now, 3)).toEqual([
      "2026-08-08",
      "2026-08-09",
      "2026-08-10",
    ]);
  });

  it("always includes today, even at the very start of the day", () => {
    const buckets = dayBuckets(Date.UTC(2026, 7, 10, 0, 0, 1), 14);
    expect(buckets).toHaveLength(14);
    expect(buckets.at(-1)).toBe("2026-08-10");
  });
});

describe("parseRange", () => {
  it("accepts every toggle value, including all-time", () => {
    for (const r of ["24h", "7d", "14d", "30d", "all"] as const) {
      expect(parseRange(r)).toBe(r);
    }
  });

  it("falls back to 14d on anything else", () => {
    expect(parseRange("lifetime")).toBe("14d");
    expect(parseRange(undefined)).toBe("14d");
  });
});

describe("monthBuckets", () => {
  it("spans month boundaries and years inclusively", () => {
    expect(
      monthBuckets("2025-11-14T08:00:00Z", Date.UTC(2026, 1, 3)),
    ).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("returns a single bucket when it all happened this month", () => {
    expect(monthBuckets("2026-08-02T00:00:00Z", Date.UTC(2026, 7, 30))).toEqual(
      ["2026-08"],
    );
  });
});

describe("lifetimeBuckets", () => {
  const now = Date.UTC(2026, 7, 10, 12);

  it("stays daily for a short history", () => {
    const { unit, buckets } = lifetimeBuckets("2026-08-08T00:00:00Z", now);
    expect(unit).toBe("day");
    expect(buckets).toEqual(["2026-08-08", "2026-08-09", "2026-08-10"]);
  });

  /**
   * A fixed daily frame would show a two-year-old workspace its last two weeks
   * and label it "all time" — the one label that promises otherwise.
   */
  it("rolls up to months once daily bars stop being legible", () => {
    const { unit, buckets } = lifetimeBuckets("2024-01-05T00:00:00Z", now);
    expect(unit).toBe("month");
    expect(buckets[0]).toBe("2024-01");
    expect(buckets.at(-1)).toBe("2026-08");
    expect(buckets.length).toBe(32);
  });

  it("gives an empty workspace a frame to render into", () => {
    // No rows means no span to measure. Collapsing to zero buckets would
    // render a chart of nothing at all rather than an empty state.
    const { unit, buckets } = lifetimeBuckets(null, now);
    expect(unit).toBe("day");
    expect(buckets).toHaveLength(30);
  });
});

describe("buildSeries", () => {
  it("folds bucket rows onto the frame in order", () => {
    const s = buildSeries(
      [
        bucket("2026-08-08", { calls: 1, connected: 1, new_leads: 3, hot: 2 }),
        bucket("2026-08-10", { calls: 2, connected: 1, new_leads: 5, cold: 5 }),
      ],
      BUCKETS,
    );
    expect(s.callsDaily.map((d) => d.count)).toEqual([1, 0, 2]);
    expect(s.newLeadsDaily.map((d) => d.count)).toEqual([3, 0, 5]);
    expect(s.totals).toEqual({ calls: 3, connected: 2, leads: 8 });
    expect([s.hot, s.warm, s.cold]).toEqual([2, 0, 5]);
  });

  /**
   * The reason `rate` is nullable at all. A day nobody dialled has no connect
   * rate; rendering it as 0% draws a cliff that reads as a collapse in
   * performance when in fact the team was off. Zero means "we called and
   * nobody picked up" — a different, and much worse, fact.
   */
  it("distinguishes a day with no calls from a day with no answers", () => {
    const s = buildSeries(
      [
        // 08th: dialled once, nobody answered → a real 0%.
        bucket("2026-08-08", { calls: 1, connected: 0 }),
        // 09th: absent from the result set entirely → null.
        // 10th: one of two connected → 50%.
        bucket("2026-08-10", { calls: 2, connected: 1 }),
      ],
      BUCKETS,
    );
    expect(s.connectRateDaily.map((d) => d.rate)).toEqual([0, null, 50]);
  });

  /**
   * One query spans both windows; the frame's first bucket is the boundary.
   * Getting this backwards silently inverts the sign of every delta on the
   * page, which looks like a working dashboard reporting the opposite trend.
   */
  it("treats anything before the first bucket as the comparison window", () => {
    const s = buildSeries(
      [
        bucket("2026-08-05", { calls: 9, connected: 4, new_leads: 7 }),
        bucket("2026-08-07", { calls: 1, connected: 1, new_leads: 1 }),
        bucket("2026-08-09", { calls: 2, connected: 2, new_leads: 3 }),
      ],
      BUCKETS,
    );
    expect(s.previous).toEqual({ calls: 10, connected: 5, leads: 8 });
    expect(s.totals).toEqual({ calls: 2, connected: 2, leads: 3 });
  });

  it("reads bigint counts that arrive as strings", () => {
    // PostgREST serialises bigint as text. Without Number(), `+` concatenates
    // and totals become "00" rather than 0.
    const s = buildSeries([bucket("2026-08-10", { calls: 2, new_leads: 3 })], BUCKETS);
    expect(s.totals.calls).toBe(2);
    expect(s.totals.leads).toBe(3);
    expect(typeof s.callsDaily[2].count).toBe("number");
  });

  it("buckets by month when asked to", () => {
    const s = buildSeries(
      [
        { ...bucket("2026-07-01", { calls: 2, connected: 1 }), bucket: "2026-07-01T00:00:00Z" },
        { ...bucket("2026-08-01", { calls: 1, connected: 1 }), bucket: "2026-08-01T00:00:00Z" },
      ],
      ["2026-06", "2026-07", "2026-08"],
      "month",
    );
    expect(s.callsDaily.map((d) => d.count)).toEqual([0, 2, 1]);
    // June had no calls at all → null, not 0%.
    expect(s.connectRateDaily.map((d) => d.rate)).toEqual([null, 50, 100]);
  });

  it("returns a full-length series for an org with no activity at all", () => {
    // The day-one case. An empty series is what made Math.max(...[]) return
    // -Infinity downstream and render a blank panel.
    const s = buildSeries([], BUCKETS);
    expect(s.callsDaily).toHaveLength(3);
    expect(s.callsDaily.every((d) => d.count === 0)).toBe(true);
    expect(s.connectRateDaily.every((d) => d.rate === null)).toBe(true);
    expect(s.totals).toEqual({ calls: 0, connected: 0, leads: 0 });
  });
});
