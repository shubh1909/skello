import { cache } from "react";

/**
 * Per-request snapshot of "now". Wrapped in `cache()` so React treats the
 * read as memoized within a render pass — keeps the purity lint happy.
 */
export const renderNow = cache((): number => Date.now());

export function initialsOf(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function formatRelative(
  iso: string | null | undefined,
  now: number = Date.now(),
): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const diffMs = date.getTime() - now;
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < hour) return rtf.format(Math.round(diffMs / minute), "minute");
  if (abs < day) return rtf.format(Math.round(diffMs / hour), "hour");
  if (abs < 7 * day) return rtf.format(Math.round(diffMs / day), "day");
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

// The semantic disposition key is an open string (per-org configurable), so we
// prettify it for display: "callback_requested" → "Callback requested". Known
// and custom labels both read naturally.
export function formatOutcomeKey(key: string): string {
  return key
    .split("_")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Strip all non-digits. wa.me requires E.164 without `+`. */
export function normalisePhoneForWa(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.replace(/\D+/g, "");
}

export function buildWaUrl(phone: string, message: string): string {
  const normalised = normalisePhoneForWa(phone);
  const text = message.trim() ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${normalised}${text}`;
}

export function toLocalDateTimeInputValue(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalDateTimeInput(value: string): string {
  // value is "YYYY-MM-DDTHH:mm" in local TZ. Convert to ISO with offset.
  const d = new Date(value);
  return d.toISOString();
}
