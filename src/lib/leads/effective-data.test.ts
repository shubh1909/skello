import { describe, expect, it } from "vitest";

import {
  buildEffectiveCustomData,
  buildEffectiveLeadData,
} from "./effective-data";

type Snapshot = {
  lead_data: Record<string, unknown>;
  custom_data: Record<string, Record<string, unknown>>;
};

function call(
  lead_data: Record<string, unknown> = {},
  custom_data: Record<string, Record<string, unknown>> = {},
): Snapshot {
  return { lead_data, custom_data };
}

describe("buildEffectiveLeadData", () => {
  it("returns null when there is nothing at all", () => {
    expect(buildEffectiveLeadData(null, null)).toBeNull();
    expect(buildEffectiveLeadData({}, [])).toBeNull();
  });

  it("backfills a gap on the lead row from a call", () => {
    const result = buildEffectiveLeadData({ name: "Asha" }, [
      call({ city: "Pune" }),
    ]);
    expect(result).toEqual({ name: "Asha", city: "Pune" });
  });

  it("never lets a call overwrite the lead row", () => {
    const result = buildEffectiveLeadData({ city: "Pune" }, [
      call({ city: "Mumbai" }),
    ]);
    expect(result).toEqual({ city: "Pune" });
  });

  // Calls arrive newest-first, and the first writer wins.
  it("prefers the newer call when two carry the same key", () => {
    const result = buildEffectiveLeadData(null, [
      call({ interest: "Sedan" }),
      call({ interest: "Hatchback" }),
    ]);
    expect(result).toEqual({ interest: "Sedan" });
  });

  it("treats blank strings as absent on both sides", () => {
    const result = buildEffectiveLeadData({ city: "   ", notes: "" }, [
      call({ city: "Pune", notes: "  " }),
    ]);
    expect(result).toEqual({ city: "Pune" });
  });

  it("keeps 0 and false, which are answers rather than gaps", () => {
    const result = buildEffectiveLeadData({ budget: 0, wants_wa: false }, []);
    expect(result).toEqual({ budget: 0, wants_wa: false });
  });
});

describe("buildEffectiveCustomData", () => {
  it("merges per category rather than replacing the bag", () => {
    const result = buildEffectiveCustomData({ vehicle: { model: "i20" } }, [
      call({}, { vehicle: { colour: "white" }, finance: { emi: "yes" } }),
    ]);
    expect(result).toEqual({
      vehicle: { model: "i20", colour: "white" },
      finance: { emi: "yes" },
    });
  });

  it("drops a category whose every value is blank", () => {
    const result = buildEffectiveCustomData({ vehicle: { model: "  " } }, []);
    expect(result).toBeNull();
  });

  it("ignores a non-object category on either side", () => {
    const result = buildEffectiveCustomData(
      { vehicle: "not a bag" as unknown as Record<string, unknown> },
      [call({}, { finance: { emi: "yes" } })],
    );
    expect(result).toEqual({ finance: { emi: "yes" } });
  });
});

/**
 * The bug this module was extracted to fix.
 *
 * The Calls tab pages, appending to the same array the summary reads. If the
 * caller passes the whole list, the summary's captured fields grow as the user
 * scrolls — which also changed what the edit form prefilled and therefore what
 * a save wrote. These tests pin both halves: passing more calls *does* change
 * the result, which is exactly why the caller must slice to page one.
 */
describe("paging invariance", () => {
  const leadRow = { name: "Asha" };
  const page1 = [call({ city: "Pune" })];
  const page2 = [call({ budget: "12L" }), call({ colour: "white" })];

  it("grows when handed a second page — the failure mode", () => {
    const first = buildEffectiveLeadData(leadRow, page1);
    const both = buildEffectiveLeadData(leadRow, [...page1, ...page2]);
    expect(first).toEqual({ name: "Asha", city: "Pune" });
    expect(both).not.toEqual(first);
    expect(Object.keys(both ?? {})).toHaveLength(4);
  });

  it("is stable when the caller pins to page one", () => {
    const all = [...page1, ...page2];
    const PAGE = page1.length;
    expect(buildEffectiveLeadData(leadRow, all.slice(0, PAGE))).toEqual(
      buildEffectiveLeadData(leadRow, page1),
    );
  });
});
