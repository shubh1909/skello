/**
 * Call-duration formatting.
 *
 * There were **seven** `formatDuration` functions in this codebase, and they
 * were not seven copies of one thing — they were two formats implemented four
 * and three times, with small disagreements inside each group:
 *
 * - `45s` vs `0m 45s` for well under a minute
 * - `3m` vs `3m 0s` on the exact minute
 * - `0:00` vs `—` vs `0s` for a missing value
 * - none of them handled an hour, so a 92-minute call rendered `92m 14s`
 *
 * Two formats survive, because both are genuinely right somewhere:
 *
 * | | Shape | Where |
 * |---|---|---|
 * | `formatDurationCompact` | `45s` · `3m 20s` · `1h 5m` | prose and detail panels — reads as a sentence |
 * | `formatDurationClock` | `0:45` · `3:20` · `1h 03m` | tables and stat cards — fixed width, so a column of them aligns |
 *
 * `empty` stays a per-call-site decision rather than being unified. A table
 * cell wants `—`; a stat card that reads "Avg call length **—**" is worse than
 * one that reads `0:00`, because there the zero *is* the answer.
 */

interface Options {
  /** Rendered for null, undefined, NaN or a negative value. */
  empty?: string;
}

function parts(seconds: number): { h: number; m: number; s: number } {
  const whole = Math.floor(seconds);
  return {
    h: Math.floor(whole / 3600),
    m: Math.floor((whole % 3600) / 60),
    s: whole % 60,
  };
}

// Phrased positively so the `true` branch narrows to `number`. The inverse
// (`seconds is null`) only strips null, leaving `number | undefined`.
function isMeasurable(seconds: number | null | undefined): seconds is number {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0;
}

/** `45s` · `3m` · `3m 20s` · `1h 5m`. */
export function formatDurationCompact(
  seconds: number | null | undefined,
  { empty = "—" }: Options = {},
): string {
  if (!isMeasurable(seconds)) return empty;
  const { h, m, s } = parts(seconds);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

/** `0:45` · `3:20` · `1h 03m`. Seconds are dropped past the hour mark. */
export function formatDurationClock(
  seconds: number | null | undefined,
  { empty = "—" }: Options = {},
): string {
  if (!isMeasurable(seconds)) return empty;
  const { h, m, s } = parts(seconds);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
