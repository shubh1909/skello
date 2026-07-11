"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDownIcon, ArrowUpIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import {
  getAbandonedCarts,
  getConvertedCarts,
  getRecoveryCalls,
} from "@/actions/shopify-recovery";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  CallStatusBadge,
  CartOutcomeBadge,
  ReachOutStatusBadge,
} from "@/components/app/recovery-badges";
import { RecoveryCallDetail } from "@/components/app/recovery-call-detail";
import { RecoveryCartDetail } from "@/components/app/recovery-cart-detail";
import {
  formatDateTime,
  formatDuration,
  formatMoney,
  productsSummary,
} from "@/lib/format/recovery";
import { cn } from "@/lib/utils";
import type {
  RecoveryAttemptRow,
  RecoveryCallRow,
  RecoveryPage,
} from "@/types/shopify";

type TabKey = "abandoned" | "converted" | "calls";

interface Props {
  organisationId: string;
  initialAbandoned: RecoveryPage<RecoveryAttemptRow>;
  initialConverted: RecoveryPage<RecoveryAttemptRow>;
  initialCalls: RecoveryPage<RecoveryCallRow>;
}

export function CartRecoveryWorkspace({
  organisationId,
  initialAbandoned,
  initialConverted,
  initialCalls,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = React.useState<TabKey>("abandoned");
  const [pending, startTransition] = React.useTransition();

  // Per-tab paged state.
  const [abandoned, setAbandoned] = React.useState(initialAbandoned.rows);
  const [abandonedTotal, setAbandonedTotal] = React.useState(initialAbandoned.total);
  const [abandonedPage, setAbandonedPage] = React.useState(0);
  const [abandonedSort, setAbandonedSort] = React.useState<"asc" | "desc">(
    "desc",
  );

  const [converted, setConverted] = React.useState(initialConverted.rows);
  const [convertedTotal, setConvertedTotal] = React.useState(initialConverted.total);
  const [convertedPage, setConvertedPage] = React.useState(0);

  const [calls, setCalls] = React.useState(initialCalls.rows);
  const [callsTotal, setCallsTotal] = React.useState(initialCalls.total);
  const [callsPage, setCallsPage] = React.useState(0);

  // The row clicked to open the drawer — kept as a fallback snapshot for when
  // the call has been paged out of the loaded `calls` list.
  const [activeCall, setActiveCall] = React.useState<RecoveryCallRow | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);

  // Cart-level drawer (opened from an All carts / Converted row).
  const [activeCart, setActiveCart] = React.useState<RecoveryAttemptRow | null>(
    null,
  );
  const [cartDetailOpen, setCartDetailOpen] = React.useState(false);

  // Keep the open detail sheet live: when realtime refreshes the calls page the
  // held snapshot goes stale (status, duration, transcript, …). Derive the
  // displayed call from the freshest loaded row, falling back to the snapshot.
  const displayedCall = React.useMemo(() => {
    if (!activeCall) return null;
    return calls.find((c) => c.id === activeCall.id) ?? activeCall;
  }, [activeCall, calls]);

  // Read-through refs so the realtime callback always sees the current page /
  // filter without rebuilding the subscription. A tab that the user has paged
  // past keeps its rows (we only refresh its count); a tab on page 0 gets its
  // rows replaced live.
  const abandonedPageRef = React.useRef(abandonedPage);
  const convertedPageRef = React.useRef(convertedPage);
  const callsPageRef = React.useRef(callsPage);
  const abandonedSortRef = React.useRef(abandonedSort);
  React.useEffect(() => {
    abandonedPageRef.current = abandonedPage;
    convertedPageRef.current = convertedPage;
    callsPageRef.current = callsPage;
    abandonedSortRef.current = abandonedSort;
  });

  // Re-pull page 0 of each tab (respecting the callable filter) + refresh the
  // server-rendered stat cards. Called on realtime activity.
  const refreshTabs = React.useCallback(() => {
    startTransition(async () => {
      const [a, c, ca] = await Promise.all([
        getAbandonedCarts({ page: 0, sort: abandonedSortRef.current }),
        getConvertedCarts({ page: 0 }),
        getRecoveryCalls({ page: 0 }),
      ]);
      if (a.success) {
        setAbandonedTotal(a.data.total);
        if (abandonedPageRef.current === 0) setAbandoned(a.data.rows);
      }
      if (c.success) {
        setConvertedTotal(c.data.total);
        if (convertedPageRef.current === 0) setConverted(c.data.rows);
      }
      if (ca.success) {
        setCallsTotal(ca.data.total);
        if (callsPageRef.current === 0) setCalls(ca.data.rows);
      }
    });
    router.refresh();
  }, [router]);

  // Live updates: recovery attempts + their calls, scoped to this org. Debounced
  // so an in-flight call's rapid status flips coalesce into one refresh.
  React.useEffect(() => {
    if (!organisationId) return;
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const queue = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refreshTabs, 400);
    };
    const channel = supabase
      .channel(`cart-recovery:${organisationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "shopify_recovery_attempts",
          filter: `organisation_id=eq.${organisationId}`,
        },
        queue,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "calls",
          filter: `organisation_id=eq.${organisationId}`,
        },
        queue,
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [organisationId, refreshTabs]);

  function loadMoreAbandoned() {
    const next = abandonedPage + 1;
    startTransition(async () => {
      const res = await getAbandonedCarts({ page: next, sort: abandonedSort });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setAbandoned((prev) => [...prev, ...res.data.rows]);
      setAbandonedTotal(res.data.total);
      setAbandonedPage(next);
    });
  }

  function toggleAbandonedSort() {
    const nextSort = abandonedSort === "desc" ? "asc" : "desc";
    setAbandonedSort(nextSort);
    startTransition(async () => {
      const res = await getAbandonedCarts({ page: 0, sort: nextSort });
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

  function openCart(cart: RecoveryAttemptRow) {
    setActiveCart(cart);
    setCartDetailOpen(true);
  }

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "abandoned", label: "Carts", count: abandonedTotal },
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

      </div>

      {tab === "abandoned" ? (
        <CartTable
          rows={abandoned}
          variant="abandoned"
          total={abandonedTotal}
          pending={pending}
          onLoadMore={loadMoreAbandoned}
          onOpen={openCart}
          sort={abandonedSort}
          onToggleSort={toggleAbandonedSort}
        />
      ) : tab === "converted" ? (
        <CartTable
          rows={converted}
          variant="converted"
          total={convertedTotal}
          pending={pending}
          onLoadMore={loadMoreConverted}
          onOpen={openCart}
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

      <RecoveryCartDetail
        cart={activeCart}
        open={cartDetailOpen}
        onOpenChange={setCartDetailOpen}
        onOpenCall={openCall}
      />

      <RecoveryCallDetail
        call={displayedCall}
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
  onOpen,
  sort,
  onToggleSort,
}: {
  rows: RecoveryAttemptRow[];
  variant: "abandoned" | "converted";
  total: number;
  pending: boolean;
  onLoadMore: () => void;
  onOpen: (cart: RecoveryAttemptRow) => void;
  sort?: "asc" | "desc";
  onToggleSort?: () => void;
}) {
  const isConverted = variant === "converted";
  const colSpan = isConverted ? 7 : 9;
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
              {!isConverted ? (
                <th className="px-4 py-3 font-medium">Cart</th>
              ) : null}
              {!isConverted ? (
                <th className="whitespace-nowrap px-4 py-3 font-medium">
                  Reach-out
                </th>
              ) : null}
              <th className="px-4 py-3 font-medium">
                {!isConverted && onToggleSort ? (
                  <button
                    type="button"
                    onClick={onToggleSort}
                    className="inline-flex items-center gap-1 font-medium uppercase tracking-wider transition-colors hover:text-foreground"
                  >
                    Abandoned
                    {sort === "asc" ? (
                      <ArrowUpIcon className="size-3.5" />
                    ) : (
                      <ArrowDownIcon className="size-3.5" />
                    )}
                  </button>
                ) : (
                  "Abandoned"
                )}
              </th>
              <th className="px-4 py-3 font-medium">
                {isConverted ? "Recovered" : "Next call"}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.length === 0 ? (
              <EmptyRow colSpan={colSpan}>
                {isConverted ? "No recovered carts yet." : "No carts to show."}
              </EmptyRow>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer align-middle hover:bg-muted/30"
                  onClick={() => onOpen(r)}
                >
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
                  {!isConverted ? (
                    <td className="px-4 py-3">
                      <CartOutcomeBadge
                        convertedAt={r.converted_at}
                        attributed={r.attributed}
                      />
                    </td>
                  ) : null}
                  {!isConverted ? (
                    <td className="whitespace-nowrap px-4 py-3">
                      <ReachOutStatusBadge
                        voiceStatus={r.status}
                        whatsappStatus={r.whatsapp_status}
                      />
                    </td>
                  ) : null}
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDateTime(r.abandoned_at ?? r.created_at)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {isConverted
                      ? formatDateTime(r.converted_at)
                      : r.status === "pending" && r.next_attempt_at
                        ? formatDateTime(r.next_attempt_at)
                        : "—"}
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
                    <CallStatusBadge status={c.status} />
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
