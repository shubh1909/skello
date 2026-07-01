"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import {
  getAbandonedCarts,
  getConvertedCarts,
  getRecoveryCalls,
} from "@/actions/shopify-recovery";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RecoveryCallDetail } from "@/components/app/recovery-call-detail";
import {
  formatDateTime,
  formatDuration,
  formatMoney,
  productsSummary,
} from "@/lib/format/recovery";
import { cn } from "@/lib/utils";
import type {
  RecoveryAttemptRow,
  RecoveryAttemptStatus,
  RecoveryCallRow,
  RecoveryPage,
} from "@/types/shopify";

type TabKey = "abandoned" | "converted" | "calls";

const STATUS_META: Record<RecoveryAttemptStatus, { label: string; className: string }> = {
  pending: { label: "Waiting", className: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  in_flight: { label: "Calling", className: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300" },
  succeeded: { label: "Reached", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
  failed: { label: "Not reached", className: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" },
  canceled: { label: "Stopped", className: "bg-muted text-muted-foreground" },
  skipped: { label: "Skipped", className: "bg-muted text-muted-foreground" },
};

interface Props {
  initialAbandoned: RecoveryPage<RecoveryAttemptRow>;
  initialConverted: RecoveryPage<RecoveryAttemptRow>;
  initialCalls: RecoveryPage<RecoveryCallRow>;
}

export function CartRecoveryWorkspace({
  initialAbandoned,
  initialConverted,
  initialCalls,
}: Props) {
  const [tab, setTab] = React.useState<TabKey>("abandoned");
  const [pending, startTransition] = React.useTransition();

  // Per-tab paged state.
  const [abandoned, setAbandoned] = React.useState(initialAbandoned.rows);
  const [abandonedTotal, setAbandonedTotal] = React.useState(initialAbandoned.total);
  const [abandonedPage, setAbandonedPage] = React.useState(0);
  const [callableOnly, setCallableOnly] = React.useState(false);

  const [converted, setConverted] = React.useState(initialConverted.rows);
  const [convertedTotal, setConvertedTotal] = React.useState(initialConverted.total);
  const [convertedPage, setConvertedPage] = React.useState(0);

  const [calls, setCalls] = React.useState(initialCalls.rows);
  const [callsTotal, setCallsTotal] = React.useState(initialCalls.total);
  const [callsPage, setCallsPage] = React.useState(0);

  const [activeCall, setActiveCall] = React.useState<RecoveryCallRow | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);

  function loadMoreAbandoned() {
    const next = abandonedPage + 1;
    startTransition(async () => {
      const res = await getAbandonedCarts({ page: next, callableOnly });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setAbandoned((prev) => [...prev, ...res.data.rows]);
      setAbandonedTotal(res.data.total);
      setAbandonedPage(next);
    });
  }

  function toggleCallable(value: boolean) {
    setCallableOnly(value);
    startTransition(async () => {
      const res = await getAbandonedCarts({ page: 0, callableOnly: value });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setAbandoned(res.data.rows);
      setAbandonedTotal(res.data.total);
      setAbandonedPage(0);
    });
  }

  function loadMoreConverted() {
    const next = convertedPage + 1;
    startTransition(async () => {
      const res = await getConvertedCarts({ page: next });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setConverted((prev) => [...prev, ...res.data.rows]);
      setConvertedTotal(res.data.total);
      setConvertedPage(next);
    });
  }

  function loadMoreCalls() {
    const next = callsPage + 1;
    startTransition(async () => {
      const res = await getRecoveryCalls({ page: next });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setCalls((prev) => [...prev, ...res.data.rows]);
      setCallsTotal(res.data.total);
      setCallsPage(next);
    });
  }

  function openCall(call: RecoveryCallRow) {
    setActiveCall(call);
    setDetailOpen(true);
  }

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "abandoned", label: "Abandoned", count: abandonedTotal },
    { key: "converted", label: "Converted", count: convertedTotal },
    { key: "calls", label: "Call history", count: callsTotal },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex gap-1 rounded-lg border border-border/60 bg-muted/30 p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm transition-colors",
                tab === t.key
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              <span className="text-xs text-muted-foreground tabular-nums">
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {tab === "abandoned" ? (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={callableOnly}
              onChange={(e) => toggleCallable(e.target.checked)}
              disabled={pending}
              className="size-4 accent-foreground"
            />
            Callable only
          </label>
        ) : null}
      </div>

      {tab === "abandoned" ? (
        <CartTable
          rows={abandoned}
          variant="abandoned"
          total={abandonedTotal}
          pending={pending}
          onLoadMore={loadMoreAbandoned}
        />
      ) : tab === "converted" ? (
        <CartTable
          rows={converted}
          variant="converted"
          total={convertedTotal}
          pending={pending}
          onLoadMore={loadMoreConverted}
        />
      ) : (
        <CallTable
          rows={calls}
          total={callsTotal}
          pending={pending}
          onLoadMore={loadMoreCalls}
          onOpen={openCall}
        />
      )}

      <RecoveryCallDetail
        call={activeCall}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  );
}

function Shopper({ row }: { row: RecoveryAttemptRow | RecoveryCallRow }) {
  const name = row.customer_name;
  const email = "email" in row ? row.email : null;
  const leadName = "lead_name" in row ? row.lead_name : null;
  const primary = name ?? leadName ?? email ?? "Unknown";
  return (
    <div className="flex min-w-0 flex-col">
      <span className="truncate font-medium">{primary}</span>
      {name && email ? (
        <span className="truncate text-xs text-muted-foreground">{email}</span>
      ) : null}
    </div>
  );
}

function Products({ items }: { items: RecoveryAttemptRow["cart_items"] }) {
  const p = productsSummary(items);
  return (
    <span className="text-muted-foreground" title={p.full}>
      {p.short}
    </span>
  );
}

function LoadMore({
  shown,
  total,
  pending,
  onLoadMore,
}: {
  shown: number;
  total: number;
  pending: boolean;
  onLoadMore: () => void;
}) {
  if (shown >= total) return null;
  return (
    <div className="flex items-center justify-center gap-3 border-t border-border/60 py-3 text-sm text-muted-foreground">
      <span>
        Showing {shown} of {total}
      </span>
      <Button type="button" size="sm" variant="outline" onClick={onLoadMore} disabled={pending}>
        {pending ? <Loader2Icon className="animate-spin" /> : null}
        Load more
      </Button>
    </div>
  );
}

function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}

function CartTable({
  rows,
  variant,
  total,
  pending,
  onLoadMore,
}: {
  rows: RecoveryAttemptRow[];
  variant: "abandoned" | "converted";
  total: number;
  pending: boolean;
  onLoadMore: () => void;
}) {
  const isConverted = variant === "converted";
  const colSpan = 8;
  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border/60 bg-muted/30 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Shopper</th>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Cart value</th>
              <th className="px-4 py-3 font-medium">Products</th>
              <th className="px-4 py-3 font-medium">Offer</th>
              <th className="px-4 py-3 font-medium">Attempts</th>
              <th className="px-4 py-3 font-medium">
                {isConverted ? "Recovery" : "Status"}
              </th>
              <th className="px-4 py-3 font-medium">
                {isConverted ? "Abandoned / Recovered" : "Abandoned / Next call"}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.length === 0 ? (
              <EmptyRow colSpan={colSpan}>
                {isConverted
                  ? "No recovered carts yet."
                  : "No abandoned carts to show."}
              </EmptyRow>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="align-middle">
                  <td className="px-4 py-3">
                    <Shopper row={r} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground">
                    {r.phone ?? "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatMoney(r.cart_total, r.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <Products items={r.cart_items} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.offer_label ?? "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {r.attempt}/{r.max_attempts}
                  </td>
                  <td className="px-4 py-3">
                    {isConverted ? (
                      r.attributed ? (
                        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                          Call-driven
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Organic</Badge>
                      )
                    ) : (
                      <>
                        <Badge className={STATUS_META[r.status].className}>
                          {STATUS_META[r.status].label}
                        </Badge>
                        {r.status === "skipped" && r.skip_reason ? (
                          <span className="ml-2 text-[11px] text-muted-foreground">
                            {r.skip_reason.replace(/_/g, " ")}
                          </span>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    <div className="flex flex-col">
                      <span>{formatDateTime(r.created_at)}</span>
                      {isConverted ? (
                        <span>recovered: {formatDateTime(r.converted_at)}</span>
                      ) : r.status === "pending" && r.next_attempt_at ? (
                        <span>next: {formatDateTime(r.next_attempt_at)}</span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <LoadMore shown={rows.length} total={total} pending={pending} onLoadMore={onLoadMore} />
    </Card>
  );
}

function CallTable({
  rows,
  total,
  pending,
  onLoadMore,
  onOpen,
}: {
  rows: RecoveryCallRow[];
  total: number;
  pending: boolean;
  onLoadMore: () => void;
  onOpen: (call: RecoveryCallRow) => void;
}) {
  const colSpan = 8;
  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border/60 bg-muted/30 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Shopper</th>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Duration</th>
              <th className="px-4 py-3 font-medium">Outcome</th>
              <th className="px-4 py-3 font-medium">Cart value</th>
              <th className="px-4 py-3 font-medium">Called</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.length === 0 ? (
              <EmptyRow colSpan={colSpan}>No recovery calls yet.</EmptyRow>
            ) : (
              rows.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer align-middle hover:bg-muted/30"
                  onClick={() => onOpen(c)}
                >
                  <td className="px-4 py-3">
                    <Shopper row={c} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground">
                    {c.to_phone ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary">{c.status}</Badge>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {formatDuration(c.duration_seconds)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.call_outcome ?? "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatMoney(c.cart_total, c.currency)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDateTime(c.started_at ?? c.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(c);
                      }}
                    >
                      View
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <LoadMore shown={rows.length} total={total} pending={pending} onLoadMore={onLoadMore} />
    </Card>
  );
}
