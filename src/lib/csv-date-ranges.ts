// Shared date-range definitions used by the leads + conversations CSV
// export dialogs and their API routes. The frontend computes concrete
// from/to ISO datetimes from a preset (or custom date inputs) and posts
// them as query params; the backend just validates and applies. Keeping
// the preset math in one place avoids the two sides drifting on what
// "Last 30 days" means.

export type ExportRangePreset =
  | "today"
  | "yesterday"
  | "last_7_days"
  | "last_30_days"
  | "last_90_days"
  | "this_month"
  | "last_month"
  | "this_year"
  | "all"
  | "custom";

export interface ExportRangeOption {
  value: ExportRangePreset;
  label: string;
  hint: string;
}

// Order matters: this is the order the picker renders them in. "Custom"
// sits next to "All time" because both are escape hatches from the
// fixed-window presets above.
export const EXPORT_RANGE_OPTIONS: ExportRangeOption[] = [
  { value: "today", label: "Today", hint: "Since 00:00 local time" },
  { value: "yesterday", label: "Yesterday", hint: "Previous calendar day" },
  { value: "last_7_days", label: "Last 7 days", hint: "Rolling 7-day window" },
  { value: "last_30_days", label: "Last 30 days", hint: "Rolling 30-day window" },
  { value: "last_90_days", label: "Last 90 days", hint: "Rolling 90-day window" },
  { value: "this_month", label: "This month", hint: "Since the 1st" },
  { value: "last_month", label: "Last month", hint: "Previous calendar month" },
  { value: "this_year", label: "This year", hint: "Since January 1st" },
  { value: "all", label: "All time", hint: "Everything on record" },
  { value: "custom", label: "Custom range", hint: "Pick exact from / to dates" },
];

export interface ExportRangeBounds {
  from: string | null; // inclusive lower bound (ISO datetime)
  to: string | null; // exclusive upper bound (ISO datetime)
}

// Compute the concrete from/to for a preset. `now` is injected so tests
// (and the server) can pin time without monkey-patching Date. Calendar-
// based presets (today, this_month, last_month, this_year) snap to the
// start of the local day instead of using rolling windows — that's the
// usual mental model for "this month" vs. "last 30 days".
export function boundsForPreset(
  preset: Exclude<ExportRangePreset, "custom">,
  now: Date = new Date(),
): ExportRangeBounds {
  const day = 24 * 60 * 60 * 1000;
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );

  switch (preset) {
    case "today":
      return { from: startOfToday.toISOString(), to: null };
    case "yesterday": {
      const startOfYesterday = new Date(startOfToday.getTime() - day);
      return {
        from: startOfYesterday.toISOString(),
        to: startOfToday.toISOString(),
      };
    }
    case "last_7_days":
      return { from: new Date(now.getTime() - 7 * day).toISOString(), to: null };
    case "last_30_days":
      return { from: new Date(now.getTime() - 30 * day).toISOString(), to: null };
    case "last_90_days":
      return { from: new Date(now.getTime() - 90 * day).toISOString(), to: null };
    case "this_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: start.toISOString(), to: null };
    }
    case "last_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: start.toISOString(), to: end.toISOString() };
    }
    case "this_year": {
      const start = new Date(now.getFullYear(), 0, 1);
      return { from: start.toISOString(), to: null };
    }
    case "all":
      return { from: null, to: null };
  }
}

// Convert a `<input type="date">` value (YYYY-MM-DD in local tz) into an
// ISO datetime at the start of that local day. Returns null for empty or
// malformed input so the caller can decide whether to leave the bound
// open or surface an error.
export function localDateInputToFromIso(input: string): string | null {
  if (!input) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d, 0, 0, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

// Same as `localDateInputToFromIso` but advances one day so the bound is
// exclusive on the to-side. "to = 2026-05-27" means "anything before the
// end of 2026-05-27" — i.e. strictly before 2026-05-28 00:00.
export function localDateInputToToIso(input: string): string | null {
  if (!input) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d + 1, 0, 0, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

// Build a filename-friendly slug for the chosen range so downloaded
// files self-describe ("skelo-leads-last_30_days-2026-05-27.csv" or
// "skelo-leads-custom-2026-05-27.csv"). The active date stamp is
// appended by the caller.
export function rangeSlug(preset: ExportRangePreset): string {
  return preset;
}
