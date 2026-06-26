// Per-campaign calling window — pure, timezone-aware helpers shared by the
// dispatcher (enforcement) and tests. No DB or `server-only` imports so this
// stays unit-testable and importable from anywhere.
//
// A window is a daily time-of-day range [startMinute, endMinute) on an allowed
// set of weekdays, interpreted in an IANA timezone. Outside it, the dispatcher
// defers a due contact to `nextCallingWindowOpen` rather than dialing.

import { zonedWallTimeToInstant } from "@/lib/time";

export interface CallingWindow {
  // Minutes since local midnight. start in [0,1439], end in [1,1440], end > start.
  startMinute: number;
  endMinute: number;
  // Allowed weekdays, 0=Sun..6=Sat. Empty array means every day.
  days: number[];
  // IANA timezone the minutes are interpreted in (e.g. "Asia/Kolkata").
  timeZone: string;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

interface ZonedParts {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  minutesOfDay: number; // 0..1439
  weekday: number; // 0=Sun..6=Sat
}

// Wall-clock parts of `date` as seen in `timeZone`.
function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) m[p.type] = p.value;
  return {
    year: Number(m.year),
    month: Number(m.month),
    day: Number(m.day),
    minutesOfDay: Number(m.hour) * 60 + Number(m.minute),
    weekday: WEEKDAY_INDEX[m.weekday] ?? 0,
  };
}

// True when `now` falls inside the window (allowed weekday AND time-of-day).
export function isWithinCallingWindow(w: CallingWindow, now: Date): boolean {
  const { minutesOfDay, weekday } = getZonedParts(now, w.timeZone);
  if (w.days.length > 0 && !w.days.includes(weekday)) return false;
  return minutesOfDay >= w.startMinute && minutesOfDay < w.endMinute;
}

// The next instant (>= now) at which the window is open. Returns `now` when the
// window is already open. Scans up to 8 days ahead, which always covers a
// non-empty weekday set; falls back to +1 day defensively.
export function nextCallingWindowOpen(w: CallingWindow, now: Date): Date {
  if (isWithinCallingWindow(w, now)) return now;

  const parts = getZonedParts(now, w.timeZone);
  const baseUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  for (let add = 0; add <= 8; add++) {
    // The calendar date `add` days after now's zoned date. Built from the zoned
    // y/m/d so getUTCDay() yields that date's weekday (0=Sun) directly.
    const target = new Date(baseUtc + add * 86_400_000);
    const weekday = target.getUTCDay();
    if (w.days.length > 0 && !w.days.includes(weekday)) continue;
    const candidate = zonedWallTimeToInstant(
      target.getUTCFullYear(),
      target.getUTCMonth() + 1,
      target.getUTCDate(),
      Math.floor(w.startMinute / 60),
      w.startMinute % 60,
      0,
      w.timeZone,
    );
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  return new Date(now.getTime() + 86_400_000);
}

// Build a CallingWindow from a campaign's columns, or null when no window is set.
export function campaignCallingWindow(c: {
  calling_window_start_minute: number | null;
  calling_window_end_minute: number | null;
  calling_window_days: number[] | null;
  calling_window_timezone: string | null;
}): CallingWindow | null {
  if (
    c.calling_window_start_minute == null ||
    c.calling_window_end_minute == null ||
    !c.calling_window_timezone
  ) {
    return null;
  }
  return {
    startMinute: c.calling_window_start_minute,
    endMinute: c.calling_window_end_minute,
    days: c.calling_window_days ?? [],
    timeZone: c.calling_window_timezone,
  };
}
