"use client";

import {
  Loader2Icon,
  PhoneIncomingIcon,
  PhoneOutgoingIcon,
} from "lucide-react";

import { CallStatusBadge } from "@/components/app/recovery-badges";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDurationCompact } from "@/lib/format/duration";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

import { CallDetailPane } from "./call-detail-pane";
import type { CallPaneCall } from "./types";

/**
 * The call browser: a list of calls on the left, the selected one in full on
 * the right.
 *
 * ## Why a rail and not a stack of drawers
 *
 * Cart recovery used to open a *second* sheet on top of the cart sheet when you
 * clicked a call, so comparing two calls on the same cart meant closing and
 * reopening, and the cart you were looking at was hidden behind the thing you
 * opened from it. A rail keeps the list, the selection and the detail on screen
 * together — which is the whole reason the lead sheet reads better.
 *
 * ## The scroll model
 *
 * Below `md` this is one column and the sheet panel does the scrolling; nesting
 * scrollers on a phone traps the outer one. At `md+` each side scrolls on its
 * own, which needs `h-full` from a parent — so the containing
 * `DetailSheetPanel` must be `fill`, or the panel scrolls *and* the panes do.
 */
export function CallSplitView<T extends CallPaneCall>({
  calls,
  total,
  selectedId,
  onSelect,
  onLoadMore,
  loadingMore = false,
  counterpartyName,
  now,
  emptyLabel = "No calls for this record yet.",
  railLabel = "Calls",
}: {
  /** `null` means still loading. `[]` means genuinely none. */
  calls: T[] | null;
  /** Server-side total, so the rail can say 8/23 rather than just 8. */
  total?: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Omit to hide the Load more button entirely. */
  onLoadMore?: () => void;
  loadingMore?: boolean;
  counterpartyName?: string | null;
  now?: number | null;
  emptyLabel?: string;
  railLabel?: string;
}) {
  const loaded = calls?.length ?? 0;
  const knownTotal = total ?? loaded;
  const hasMore = Boolean(onLoadMore) && loaded < knownTotal;
  const selected = calls?.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="grid grid-cols-1 md:h-full md:min-h-0 md:grid-cols-[300px_1fr]">
      <aside className="flex flex-col border-b border-border/60 md:min-h-0 md:border-b-0 md:border-r">
        <header className="flex items-center justify-between border-b border-border/60 bg-primary/3 px-4 py-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {railLabel}
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {loaded}
            {knownTotal > loaded ? ` / ${knownTotal}` : ""}
          </span>
        </header>

        <div className="md:min-h-0 md:flex-1 md:overflow-y-auto">
          {calls === null ? (
            <div className="flex flex-col gap-2 p-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : calls.length === 0 ? (
            <div className="p-4">
              <Empty>
                <EmptyHeader>
                  <EmptyDescription>{emptyLabel}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {calls.map((call) => (
                <CallRailRow
                  key={call.id}
                  call={call}
                  selected={call.id === selectedId}
                  onSelect={() => onSelect(call.id)}
                  now={now}
                />
              ))}
            </ul>
          )}

          {hasMore ? (
            <div className="p-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={onLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? <Loader2Icon className="animate-spin" /> : null}
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </div>
      </aside>

      <div className="md:min-h-0 md:overflow-y-auto">
        {selected ? (
          <CallDetailPane
            call={selected}
            counterpartyName={counterpartyName}
            now={now}
          />
        ) : (
          <div className="flex min-h-60 items-center justify-center p-10 text-center text-sm text-muted-foreground md:h-full md:min-h-0">
            {calls === null
              ? "Loading calls…"
              : calls.length === 0
                ? emptyLabel
                : "Select a call on the left to see its recording, transcript and captured fields."}
          </div>
        )}
      </div>
    </div>
  );
}

function CallRailRow({
  call,
  selected,
  onSelect,
  now,
}: {
  call: CallPaneCall;
  selected: boolean;
  onSelect: () => void;
  now?: number | null;
}) {
  const inbound = call.direction === "inbound";
  const DirectionIcon = inbound ? PhoneIncomingIcon : PhoneOutgoingIcon;
  const counterparty = inbound ? call.from_phone : call.to_phone;
  const duration = formatDurationCompact(call.duration_seconds, { empty: "" });

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full items-start gap-2 px-4 py-3 text-left transition-colors focus-visible:outline-none",
          selected
            ? "bg-primary/7 text-foreground"
            : "hover:bg-muted/50 focus-visible:bg-muted/50",
        )}
      >
        <DirectionIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm tabular-nums">
            {counterparty ?? "Unknown number"}
          </p>
          <p className="text-xs text-muted-foreground" suppressHydrationWarning>
            {now == null ? "" : formatRelative(call.started_at, now)}
            {duration ? ` · ${duration}` : ""}
          </p>
        </div>
        <CallStatusBadge status={call.status} />
      </button>
    </li>
  );
}
