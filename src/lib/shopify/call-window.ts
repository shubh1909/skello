// Cart-recovery calling window — decide whether "now" is inside an org's
// configured dial window, and when the window next opens. Times are tz-naive
// wall clocks (HH:MM[:SS]) evaluated in a given timezone (APP_TIMEZONE in prod).
//
// Pure (no server-only) so it stays unit-testable and importable anywhere.

import { zonedWallTimeToInstant } from "@/lib/time";

interface Hm {
  h: number;
  m: number;
}

// "HH:MM" or "HH:MM:SS" → minutes since midnight. Postgres `time` serialises as
// "HH:MM:SS"; an <input type="time"> yields "HH:MM". Both parse here.
function parseHm(s: string | null | undefined): Hm | null {
  if (!s) return null;
  const m = /^(\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

// The wall-clock parts of `date` as seen in `timeZone`.
function zonedParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
  };
}

/**
 * Is `now` inside the [start, end) dial window (evaluated in `timeZone`)?
 *
 *   - Either bound missing → no window configured → always callable.
 *   - start === end → treated as an all-day window (always callable).
 *   - start < end   → same-day window (e.g. 10:00–19:00).
 *   - start > end   → overnight window that wraps midnight (e.g. 21:00–06:00).
 */
export function isWithinCallWindow(
  now: Date,
  start: string | null | undefined,
  end: string | null | undefined,
  timeZone: string,
): boolean {
  const s = parseHm(start);
  const e = parseHm(end);
  if (!s || !e) return true;

  const sm = s.h * 60 + s.m;
  const em = e.h * 60 + e.m;
  if (sm === em) return true;

  const z = zonedParts(now, timeZone);
  const cur = z.hour * 60 + z.minute;
  return sm < em ? cur >= sm && cur < em : cur >= sm || cur < em;
}

/**
 * The next instant (as a UTC Date) at which the window opens, strictly after
 * `now`. Today's open if it's still ahead, otherwise tomorrow's. Returns `now`
 * unchanged when no window is configured (so callers can defer unconditionally).
 */
export function nextCallWindowOpen(
  now: Date,
  start: string | null | undefined,
  timeZone: string,
): Date {
  const s = parseHm(start);
  if (!s) return now;

  const z = zonedParts(now, timeZone);
  const openToday = zonedWallTimeToInstant(
    z.year,
    z.month,
    z.day,
    s.h,
    s.m,
    0,
    timeZone,
  );
  if (openToday.getTime() > now.getTime()) return openToday;
  // Date.UTC (inside zonedWallTimeToInstant) normalises the day overflow.
  return zonedWallTimeToInstant(z.year, z.month, z.day + 1, s.h, s.m, 0, timeZone);
}
