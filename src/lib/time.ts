// Timezone primitives + provider-timestamp parsing.
//
// The core problem this solves: the voice provider (and the agent's spoken
// times like "call me back at 3pm") emit wall-clock timestamps in the
// customer's LOCAL zone, often WITHOUT a timezone designator. Parsing those
// with bare `new Date(str)` interprets them in the SERVER's zone — on a UTC
// host that silently shifts every stored instant by the local offset (e.g.
// +5:30 for IST), so callbacks fire late and displayed times disagree with the
// provider's dashboard. Interpreting naive strings in an explicit zone fixes it
// regardless of where the server runs.
//
// Pure (no `server-only`) so it stays unit-testable and importable anywhere.

// Default zone for interpreting timezone-less provider/agent timestamps.
// Override per deployment via APP_DEFAULT_TIMEZONE (e.g. a non-IST workspace).
export const APP_TIMEZONE =
  process.env.APP_DEFAULT_TIMEZONE?.trim() || "Asia/Kolkata";

// A bare ISO-ish wall clock with NO timezone: date, optional time, optional
// seconds, optional fractional seconds. "2026-06-24", "2026-06-24 15:00",
// "2026-06-24T15:00:00", "2026-06-24T15:00:00.123".
const NAIVE_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;

// Carries an explicit timezone (Z, ±HH:MM, or ±HHMM) at the end.
const HAS_TZ = /(?:Z|[+-]\d{2}:?\d{2})$/i;

// Offset (ms) of `timeZone` from UTC at the given instant. Positive east of UTC.
export function getZonedOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) m[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(m.year),
    Number(m.month) - 1,
    Number(m.day),
    Number(m.hour),
    Number(m.minute),
    Number(m.second),
  );
  return asUtc - date.getTime();
}

// Convert a wall-clock time in `timeZone` to the UTC instant it refers to.
// Two-pass to settle the offset across DST transitions.
export function zonedWallTimeToInstant(
  year: number,
  month: number, // 1..12
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = getZonedOffsetMs(new Date(guess), timeZone);
  let instant = guess - offset;
  const offset2 = getZonedOffsetMs(new Date(instant), timeZone);
  if (offset2 !== offset) instant = guess - offset2;
  return new Date(instant);
}

/**
 * Parse a provider/agent timestamp to a UTC ISO string.
 *
 *   - A string WITH a timezone (Z / ±HH:MM) is trusted as-is.
 *   - A timezone-less (naive) wall clock is interpreted in `timeZone`
 *     (default APP_TIMEZONE) — NOT the server's local zone.
 *   - Anything unparseable returns null (never throws).
 */
export function parseProviderTimestamp(
  v: string | null | undefined,
  timeZone: string = APP_TIMEZONE,
): string | null {
  if (!v) return null;
  const s = v.trim();
  if (!s) return null;

  if (HAS_TZ.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  const m = NAIVE_DATETIME.exec(s);
  if (m) {
    const [, y, mo, d, hh, mi, ss] = m;
    return zonedWallTimeToInstant(
      Number(y),
      Number(mo),
      Number(d),
      Number(hh ?? 0),
      Number(mi ?? 0),
      Number(ss ?? 0),
      timeZone,
    ).toISOString();
  }

  // Unrecognised shape — best effort, but a bad string must not throw.
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
