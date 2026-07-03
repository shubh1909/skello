import { describe, expect, it } from "vitest";

import { isWithinCallWindow, nextCallWindowOpen } from "./call-window";

const IST = "Asia/Kolkata";

// 2026-07-03 08:30 UTC == 14:00 IST (+5:30).
const AT_1400_IST = new Date("2026-07-03T08:30:00Z");
// 2026-07-03 16:00 UTC == 21:30 IST.
const AT_2130_IST = new Date("2026-07-03T16:00:00Z");
// 2026-07-03 02:00 UTC == 07:30 IST.
const AT_0730_IST = new Date("2026-07-03T02:00:00Z");

describe("isWithinCallWindow", () => {
  it("is always open when no window is configured", () => {
    expect(isWithinCallWindow(AT_2130_IST, null, null, IST)).toBe(true);
    expect(isWithinCallWindow(AT_2130_IST, "10:00", null, IST)).toBe(true);
  });

  it("respects a same-day window (10:00–19:00 IST)", () => {
    expect(isWithinCallWindow(AT_1400_IST, "10:00", "19:00", IST)).toBe(true);
    expect(isWithinCallWindow(AT_2130_IST, "10:00", "19:00", IST)).toBe(false);
    expect(isWithinCallWindow(AT_0730_IST, "10:00", "19:00", IST)).toBe(false);
  });

  it("accepts postgres HH:MM:SS times", () => {
    expect(isWithinCallWindow(AT_1400_IST, "10:00:00", "19:00:00", IST)).toBe(
      true,
    );
  });

  it("handles an overnight window (21:00–06:00 IST)", () => {
    expect(isWithinCallWindow(AT_2130_IST, "21:00", "06:00", IST)).toBe(true);
    expect(isWithinCallWindow(AT_1400_IST, "21:00", "06:00", IST)).toBe(false);
  });
});

describe("nextCallWindowOpen", () => {
  it("returns today's open when it is still ahead", () => {
    // 07:30 IST, window opens 10:00 IST → same calendar day.
    const next = nextCallWindowOpen(AT_0730_IST, "10:00", IST);
    // 10:00 IST == 04:30 UTC.
    expect(next.toISOString()).toBe("2026-07-03T04:30:00.000Z");
  });

  it("rolls to tomorrow when the open time has passed", () => {
    // 21:30 IST, window opens 10:00 IST → next day.
    const next = nextCallWindowOpen(AT_2130_IST, "10:00", IST);
    expect(next.toISOString()).toBe("2026-07-04T04:30:00.000Z");
  });

  it("returns now unchanged when no start is set", () => {
    expect(nextCallWindowOpen(AT_2130_IST, null, IST)).toBe(AT_2130_IST);
  });
});
