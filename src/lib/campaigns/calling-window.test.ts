import { describe, expect, it } from "vitest";

import {
  campaignCallingWindow,
  isWithinCallingWindow,
  nextCallingWindowOpen,
  type CallingWindow,
} from "@/lib/campaigns/calling-window";

// 09:00–18:00 in minutes-since-midnight.
const NINE_AM = 9 * 60;
const SIX_PM = 18 * 60;

function window(overrides: Partial<CallingWindow> = {}): CallingWindow {
  return {
    startMinute: NINE_AM,
    endMinute: SIX_PM,
    days: [],
    timeZone: "Asia/Kolkata",
    ...overrides,
  };
}

describe("isWithinCallingWindow", () => {
  const w = window(); // every day, 09:00–18:00 IST (UTC+5:30)

  it("is open at a mid-window local time", () => {
    // 12:00 IST = 06:30 UTC.
    const now = new Date("2026-06-23T06:30:00Z");
    expect(isWithinCallingWindow(w, now)).toBe(true);
  });

  it("is closed before the window opens", () => {
    // 08:59 IST = 03:29 UTC.
    const now = new Date("2026-06-23T03:29:00Z");
    expect(isWithinCallingWindow(w, now)).toBe(false);
  });

  it("is closed at the exclusive end minute", () => {
    // 18:00 IST = 12:30 UTC — end is exclusive, so closed.
    const now = new Date("2026-06-23T12:30:00Z");
    expect(isWithinCallingWindow(w, now)).toBe(false);
  });

  it("is open at the inclusive start minute", () => {
    // 09:00 IST = 03:30 UTC.
    const now = new Date("2026-06-23T03:30:00Z");
    expect(isWithinCallingWindow(w, now)).toBe(true);
  });

  it("honors the allowed-weekday set", () => {
    // 2026-06-23 is a Tuesday. Mon–Fri = [1,2,3,4,5].
    const weekdays = window({ days: [1, 2, 3, 4, 5] });
    const tuesdayNoon = new Date("2026-06-23T06:30:00Z");
    expect(isWithinCallingWindow(weekdays, tuesdayNoon)).toBe(true);

    // 2026-06-21 is a Sunday → excluded even at a valid time-of-day.
    const sundayNoon = new Date("2026-06-21T06:30:00Z");
    expect(isWithinCallingWindow(weekdays, sundayNoon)).toBe(false);
  });
});

describe("nextCallingWindowOpen", () => {
  it("returns now when already open", () => {
    const w = window();
    const now = new Date("2026-06-23T06:30:00Z"); // 12:00 IST
    expect(nextCallingWindowOpen(w, now).getTime()).toBe(now.getTime());
  });

  it("returns today's open when before the window", () => {
    const w = window();
    const now = new Date("2026-06-23T03:00:00Z"); // 08:30 IST
    // Next open = 09:00 IST = 03:30 UTC.
    expect(nextCallingWindowOpen(w, now).toISOString()).toBe(
      "2026-06-23T03:30:00.000Z",
    );
  });

  it("rolls to tomorrow when after the window closes", () => {
    const w = window();
    const now = new Date("2026-06-23T13:00:00Z"); // 18:30 IST (past 18:00)
    // Next open = 09:00 IST next day = 2026-06-24T03:30Z.
    expect(nextCallingWindowOpen(w, now).toISOString()).toBe(
      "2026-06-24T03:30:00.000Z",
    );
  });

  it("skips disallowed weekdays", () => {
    // Mon–Fri only. 2026-06-19 is a Friday; after close it must jump to Monday
    // 2026-06-22, skipping Sat/Sun.
    const w = window({ days: [1, 2, 3, 4, 5] });
    const fridayEvening = new Date("2026-06-19T13:00:00Z"); // 18:30 IST Fri
    expect(nextCallingWindowOpen(w, fridayEvening).toISOString()).toBe(
      "2026-06-22T03:30:00.000Z",
    );
  });

  it("crosses a DST transition correctly (US Eastern)", () => {
    // US DST ended 2025-11-02 (clocks fell back at 02:00 → EST, UTC-5).
    // Window 09:00–18:00 America/New_York. On 2025-11-02 at 08:00 EST
    // (13:00 UTC) the window opens at 09:00 EST = 14:00 UTC.
    const w = window({ timeZone: "America/New_York" });
    const now = new Date("2025-11-02T13:00:00Z");
    expect(nextCallingWindowOpen(w, now).toISOString()).toBe(
      "2025-11-02T14:00:00.000Z",
    );
  });
});

describe("campaignCallingWindow", () => {
  it("returns null when no window is configured", () => {
    expect(
      campaignCallingWindow({
        calling_window_start_minute: null,
        calling_window_end_minute: null,
        calling_window_days: [],
        calling_window_timezone: null,
      }),
    ).toBeNull();
  });

  it("builds a window from columns", () => {
    expect(
      campaignCallingWindow({
        calling_window_start_minute: NINE_AM,
        calling_window_end_minute: SIX_PM,
        calling_window_days: [1, 2, 3, 4, 5],
        calling_window_timezone: "Asia/Kolkata",
      }),
    ).toEqual({
      startMinute: NINE_AM,
      endMinute: SIX_PM,
      days: [1, 2, 3, 4, 5],
      timeZone: "Asia/Kolkata",
    });
  });
});
