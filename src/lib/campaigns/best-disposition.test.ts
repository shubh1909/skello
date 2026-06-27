import { describe, expect, it } from "vitest";

import type { OutcomePolicy } from "@/types/outcome-policy";
import {
  buildOutcomeRanking,
  pickBestOutcome,
  TOP_DISPOSITION_PRIORITIES,
} from "@/lib/campaigns/best-disposition";

// Minimal policy rows — only the fields the ranking cares about.
function policy(
  outcome_key: string,
  position: number,
  is_fallback = false,
): Pick<OutcomePolicy, "outcome_key" | "position" | "is_fallback"> {
  return { outcome_key, position, is_fallback };
}

// The seeded default order: interested(0) … do_not_call(5), no_decision(6).
const DEFAULT_POLICIES = [
  policy("interested", 0),
  policy("meeting_booked", 1),
  policy("callback_requested", 2),
  policy("not_interested", 3),
  policy("wrong_number", 4),
  policy("do_not_call", 5),
  policy("no_decision", 6, true),
];

describe("buildOutcomeRanking", () => {
  it("keeps only the top priorities, ordered by position", () => {
    const ranking = buildOutcomeRanking(DEFAULT_POLICIES);
    expect(ranking.size).toBe(TOP_DISPOSITION_PRIORITIES);
    expect(ranking.get("interested")).toBe(0);
    expect(ranking.get("wrong_number")).toBe(4);
    // 6th-ranked and the fallback fall outside the top priorities.
    expect(ranking.has("do_not_call")).toBe(false);
    expect(ranking.has("no_decision")).toBe(false);
  });

  it("excludes the fallback even when it sorts within the first five", () => {
    const ranking = buildOutcomeRanking([
      policy("no_decision", 0, true),
      policy("interested", 1),
      policy("meeting_booked", 2),
    ]);
    expect(ranking.has("no_decision")).toBe(false);
    expect(ranking.get("interested")).toBe(0);
    expect(ranking.get("meeting_booked")).toBe(1);
  });

  it("sorts by position regardless of input order", () => {
    const ranking = buildOutcomeRanking([
      policy("third", 30),
      policy("first", 10),
      policy("second", 20),
    ]);
    expect([...ranking.entries()]).toEqual([
      ["first", 0],
      ["second", 1],
      ["third", 2],
    ]);
  });
});

describe("pickBestOutcome", () => {
  const ranking = buildOutcomeRanking(DEFAULT_POLICIES);

  it("returns the highest-priority outcome that occurred", () => {
    expect(
      pickBestOutcome(["not_interested", "interested", "wrong_number"], ranking),
    ).toBe("interested");
  });

  it("ignores outcomes outside the top priorities", () => {
    // do_not_call (rank 6) and no_decision (fallback) are not ranked; only
    // not_interested counts.
    expect(
      pickBestOutcome(["do_not_call", "no_decision", "not_interested"], ranking),
    ).toBe("not_interested");
  });

  it("returns null when nothing occurred within the top priorities", () => {
    expect(pickBestOutcome(["do_not_call", "no_decision"], ranking)).toBeNull();
  });

  it("returns null for an empty set", () => {
    expect(pickBestOutcome([], ranking)).toBeNull();
  });
});
