"use client";

import * as React from "react";

import { CodConfirmationDetail } from "@/components/app/cod-confirmation-detail";
import { DataTableCard, DataTableHead } from "@/components/app/data-table";
import { SectionLabel } from "@/components/app/section-label";
import { Badge } from "@/components/ui/badge";
import { codOutcome } from "@/lib/cod/status";
import { formatDateTime, formatMoney } from "@/lib/format/recovery";
import type { CodConfirmationRow } from "@/types/cod";

export function CodConfirmationsTable({
  rows,
  total,
}: {
  rows: CodConfirmationRow[];
  total: number;
}) {
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);

  // Derived from the live `rows` rather than snapshotted on click, so a
  // realtime refresh updates the open sheet instead of leaving it stale.
  const active = activeId ? (rows.find((r) => r.id === activeId) ?? null) : null;

  function openOrder(row: CodConfirmationRow) {
    setActiveId(row.id);
    setDetailOpen(true);
  }

  return (
    <>
      <DataTableCard>
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
          <SectionLabel as="span">Recent orders</SectionLabel>
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
              <DataTableHead filled={false}>
                <th className="px-5 py-2.5 font-medium">Order</th>
                <th className="px-5 py-2.5 font-medium">Customer</th>
                <th className="px-5 py-2.5 font-medium">Total</th>
                <th className="px-5 py-2.5 font-medium">Attempts</th>
                <th className="px-5 py-2.5 font-medium">Outcome</th>
                <th className="px-5 py-2.5 font-medium">Placed</th>
              </DataTableHead>
              <tbody>
                {rows.map((row) => {
                  const outcome = codOutcome(row);
                  return (
                    <tr
                      key={row.id}
                      // Rows are interactive now — the confirmation calls this
                      // section places had no surface at all before.
                      tabIndex={0}
                      role="button"
                      aria-label={`Open ${row.order_name ?? "COD order"}`}
                      onClick={() => openOrder(row)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.preventDefault();
                        openOrder(row);
                      }}
                      className="cursor-pointer border-b border-border/40 transition-colors last:border-0 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                    >
                      <td className="px-5 py-3 font-medium">
                        {row.order_name ?? "—"}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-col">
                          <span className="truncate">
                            {row.customer_name ?? "—"}
                          </span>
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {row.phone ?? "—"}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3 tabular-nums">
                        {formatMoney(row.order_total, row.currency)}
                      </td>
                      <td className="px-5 py-3 tabular-nums text-muted-foreground">
                        {row.attempt}/{row.max_attempts}
                      </td>
                      <td className="px-5 py-3">
                        <Badge variant={outcome.variant}>{outcome.label}</Badge>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {formatDateTime(row.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DataTableCard>

      <CodConfirmationDetail
        order={active}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </>
  );
}
