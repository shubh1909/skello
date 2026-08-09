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

/**
 * Pick one of the eight muted avatar tones for a name, deterministically.
 *
 * Returns the **surface and its foreground together** — `bg-avatar-3 text-white`
 * — because the two are not independent choices: the tones are dark enough to
 * need white on top, and a caller pairing one with `text-muted-foreground`
 * would land at about 1.5:1. Tailwind classes rather than a number, so the
 * values stay in globals.css, and written out in full because Tailwind scans
 * source *text* — `bg-avatar-${n}` produces no CSS at all.
 *
 * Deterministic on purpose: the same person keeps their colour across the
 * table, the detail sheet and the pulse list, which is what makes it read as
 * identity rather than decoration.
 *
 * An unknown name gets the neutral surface rather than tone 1 — otherwise every
 * unnamed lead in a table shares a colour and looks like the same person.
 */
const AVATAR_TONES = [
  "bg-avatar-1 text-white",
  "bg-avatar-2 text-white",
  "bg-avatar-3 text-white",
  "bg-avatar-4 text-white",
  "bg-avatar-5 text-white",
  "bg-avatar-6 text-white",
  "bg-avatar-7 text-white",
  "bg-avatar-8 text-white",
] as const;

export function avatarTone(seed: string | null | undefined): string {
  const key = seed?.trim();
  if (!key) return "bg-muted text-muted-foreground";
  // djb2-ish. Any stable hash works; this one is short and has no collisions
  // worth caring about across eight buckets.
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0;
  }
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
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

/**
 * The compact variant: "Aug 8, 2:30 PM" — no year.
 *
 * A separate function rather than an option on `formatDateTime`, because the
 * two are used in different places for a reason: a table column needs the
 * narrow one to keep its width, a detail panel needs the year. `conversations-table.tsx`
 * carried its own byte-identical copy of this.
 */
export function formatDateTimeShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
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
