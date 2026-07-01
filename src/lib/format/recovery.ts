import type { RecoveryCartItem } from "@/types/shopify";

// Pure, client-safe formatters shared across the recovery dashboard, tables, and
// call-detail drawer. No server-only imports.

export function formatMoney(
  amount: number | null,
  currency: string | null,
): string {
  if (amount === null) return "—";
  if (!currency) return amount.toLocaleString();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

// DB timestamptz values are absolute — render them in the viewer's locale.
export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Highest-value product first; ">1 product" collapses to "Top +N".
export function productsSummary(items: RecoveryCartItem[]): {
  short: string;
  full: string;
} {
  if (!items || items.length === 0) return { short: "—", full: "" };
  const sorted = [...items].sort((a, b) => (b.lineValue ?? 0) - (a.lineValue ?? 0));
  const top = sorted[0].title;
  const short = items.length > 1 ? `${top} +${items.length - 1}` : top;
  const full = sorted
    .map((i) => (i.quantity > 1 ? `${i.title} ×${i.quantity}` : i.title))
    .join(", ");
  return { short, full };
}
