import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatDateTime, formatMoney } from "@/lib/format/recovery";
import { cn } from "@/lib/utils";
import type { CodConfirmationRow } from "@/types/cod";

// Map a confirmation row to the disposition badge the merchant reads. The
// `confirmed` disposition only exists once we've reached the customer, so it's
// layered on top of the dial status.
function outcomeBadge(row: CodConfirmationRow): {
  label: string;
  className: string;
} {
  const positive =
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300";
  const negative =
    "bg-destructive/10 text-destructive dark:bg-destructive/20";
  const neutral = "bg-muted text-muted-foreground";
  const active =
    "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300";

  switch (row.status) {
    case "confirmed_call":
      if (row.confirmed === true) return { label: "Confirmed", className: positive };
      if (row.confirmed === false) return { label: "Declined", className: negative };
      return { label: "Reached", className: neutral };
    case "failed":
      return { label: "Not reached", className: negative };
    case "pending":
      return { label: "Queued", className: active };
    case "in_flight":
      return { label: "Calling", className: active };
    case "canceled":
      return { label: "Canceled", className: neutral };
    case "skipped":
      return { label: "Skipped", className: neutral };
    default:
      return { label: row.status, className: neutral };
  }
}

export function CodConfirmationsTable({
  rows,
  total,
}: {
  rows: CodConfirmationRow[];
  total: number;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
        <span className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Recent orders
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {total.toLocaleString()} total
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          No COD orders yet. Once a Cash-on-Delivery order comes in, it&apos;ll
          appear here with its confirmation status.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Order</th>
                <th className="px-5 py-2.5 font-medium">Customer</th>
                <th className="px-5 py-2.5 font-medium">Total</th>
                <th className="px-5 py-2.5 font-medium">Attempts</th>
                <th className="px-5 py-2.5 font-medium">Outcome</th>
                <th className="px-5 py-2.5 font-medium">Placed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const badge = outcomeBadge(r);
                return (
                  <tr
                    key={r.id}
                    className="border-b border-border/40 last:border-0"
                  >
                    <td className="px-5 py-3 font-medium">
                      {r.order_name ?? "—"}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-col">
                        <span className="truncate">
                          {r.customer_name ?? "—"}
                        </span>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {r.phone ?? "—"}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3 tabular-nums">
                      {formatMoney(r.order_total, r.currency)}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-muted-foreground">
                      {r.attempt}/{r.max_attempts}
                    </td>
                    <td className="px-5 py-3">
                      <Badge className={cn("font-medium", badge.className)}>
                        {badge.label}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {formatDateTime(r.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
