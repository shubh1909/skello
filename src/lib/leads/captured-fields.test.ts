import { describe, expect, it } from "vitest";

import {
  CALL_LEAD_DATA_SURFACED,
  LEAD_DATA_SURFACED,
  TRANSCRIPT_SURFACED,
  buildCustomFieldGroups,
  pickLeadDataExtras,
} from "./captured-fields";

describe("surfaced key sets", () => {
  // They were three hand-written literals in three files. Deriving them from
  // one base is only worth anything if the deltas stay exactly this small.
  it("are supersets of the shared base", () => {
    for (const key of CALL_LEAD_DATA_SURFACED) {
      expect(LEAD_DATA_SURFACED.has(key)).toBe(true);
      expect(TRANSCRIPT_SURFACED.has(key)).toBe(true);
    }
  });

  it("differ only by their documented extras", () => {
    const extra = (set: ReadonlySet<string>) =>
      [...set].filter((k) => !CALL_LEAD_DATA_SURFACED.has(k)).sort();
    expect(extra(LEAD_DATA_SURFACED)).toEqual(["city", "pincode"]);
    expect(extra(TRANSCRIPT_SURFACED)).toEqual(["product"]);
  });

  it("hides the extractor's internal routing key everywhere", () => {
    expect(CALL_LEAD_DATA_SURFACED.has("business_slug")).toBe(true);
  });
});

describe("pickLeadDataExtras", () => {
  it("returns null rather than an empty object", () => {
    expect(pickLeadDataExtras(null, new Set())).toBeNull();
    expect(pickLeadDataExtras({ name: "Asha" }, new Set(["name"]))).toBeNull();
  });

  it("drops skipped keys and blank values", () => {
    expect(
      pickLeadDataExtras(
        { name: "Asha", budget: "12L", colour: "  ", seats: null },
        new Set(["name"]),
      ),
    ).toEqual({ budget: "12L" });
  });

  it("keeps 0 and false", () => {
    expect(pickLeadDataExtras({ n: 0, b: false }, new Set())).toEqual({
      n: 0,
      b: false,
    });
  });
});

describe("buildCustomFieldGroups", () => {
  it("puts the ungrouped bucket first, with no heading", () => {
    const groups = buildCustomFieldGroups(
      { vehicle: { model: "i20" } },
      { budget: "12L" },
    );
    expect(groups[0].category).toBe("");
    expect(groups[0].entries).toEqual([["budget", "12L"]]);
    expect(groups[1]).toEqual({
      category: "vehicle",
      entries: [["model", "i20"]],
    });
  });

  // "" / "__general__" / "general" all mean ungrouped — shared with the CSV
  // exports so the two can't disagree about it.
  it("hoists the ungrouped category aliases instead of naming them", () => {
    const groups = buildCustomFieldGroups(
      { __general__: { a: "1" }, general: { b: "2" }, "": { c: "3" } },
      null,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe("");
    expect(groups[0].entries.map(([k]) => k).sort()).toEqual(["a", "b", "c"]);
  });

  it("drops a category once its blank values are filtered out", () => {
    expect(buildCustomFieldGroups({ vehicle: { model: "  " } }, null)).toEqual(
      [],
    );
  });
});
