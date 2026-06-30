import {
  CheckCircle2Icon,
  PhoneIcon,
  ShoppingCartIcon,
  TrendingUpIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/app/stat-card";
import type {
  RecoveryAttemptRow,
  RecoveryAttemptStatus,
  RecoveryMetrics,
} from "@/types/shopify";

const STATUS_LABEL: Record<RecoveryAttemptStatus, string> = {
  pending: "Waiting",
  in_flight: "Calling",
  succeeded: "Reached",
  failed: "Not reached",
  canceled: "Recovered",
  skipped: "Skipped",
};

const STATUS_CLASS: Record<RecoveryAttemptStatus, string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  in_flight: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  succeeded:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  canceled:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  skipped: "bg-muted text-muted-foreground",
};

function formatMoney(amount: number, currency: string | null): string {
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

function cartSummary(row: RecoveryAttemptRow): string {
  const count = row.cart_items.reduce((n, i) => n + (i.quantity || 1), 0);
  const items = count === 1 ? "1 item" : `${count} items`;
  if (row.cart_total !== null) {
    return `${items} · ${formatMoney(row.cart_total, row.currency)}`;
  }
  return items;
}

export function CartRecoveryDashboard({
  metrics,
  attempts,
}: {
  metrics: RecoveryMetrics;
  attempts: RecoveryAttemptRow[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Carts abandoned"
          value={metrics.abandoned.toLocaleString()}
          icon={<ShoppingCartIcon />}
          hint="All time"
        />
        <StatCard
          label="Calls made"
          value={metrics.calls_made.toLocaleString()}
          icon={<PhoneIcon />}
          hint="Carts we dialled"
        />
        <StatCard
          label="Carts recovered"
          value={metrics.recovered.toLocaleString()}
          icon={<CheckCircle2Icon />}
          hint="Completed after the call"
        />
        <StatCard
          label="Revenue recovered"
          value={formatMoney(metrics.revenue_recovered, metrics.currency)}
          icon={<TrendingUpIcon />}
          hint="From recovered carts"
        />
      </section>

      {attempts.length === 0 ? (
        <Card className="items-center gap-3 py-16 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-muted">
            <ShoppingCartIcon className="size-5 text-muted-foreground" />
          </span>
          <p className="font-medium">No abandoned carts yet</p>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            Once shoppers abandon checkout on your connected store, their recovery
            calls will appear here.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border/60 bg-muted/30">
                <tr className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Shopper</th>
                  <th className="px-4 py-3 font-medium">Cart</th>
                  <th className="px-4 py-3 font-medium">Offer</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {attempts.map((a) => (
                  <tr key={a.id} className="align-middle">
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">
                          {a.customer_name ?? a.email ?? "Unknown"}
                        </span>
                        {a.phone ? (
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {a.phone}
                          </span>
                        ) : a.customer_name && a.email ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {a.email}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {cartSummary(a)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {a.offer_label ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={STATUS_CLASS[a.status]}>
                        {a.converted_at && a.status !== "skipped"
                          ? "Recovered"
                          : STATUS_LABEL[a.status]}
                      </Badge>
                      {a.status === "skipped" && a.skip_reason ? (
                        <span className="ml-2 text-[11px] text-muted-foreground">
                          {a.skip_reason.replace(/_/g, " ")}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
