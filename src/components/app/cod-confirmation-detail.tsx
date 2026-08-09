"use client";

import * as React from "react";

import { CallSplitView } from "@/components/app/call-detail";
import {
  DescriptionList,
  DetailPanel,
  DetailSheetPanel,
  DetailSheetShell,
  DetailTimeline,
  type TimelineEvent,
} from "@/components/app/detail-sheet";
import { Badge } from "@/components/ui/badge";
import { getCodCallsForConfirmation } from "@/actions/cod-confirmation";
import { useClientNow } from "@/hooks/use-client-now";
import { formatDateTime, formatMoney } from "@/lib/format/recovery";
import { codOutcome } from "@/lib/cod/status";
import type { CodCallRow, CodConfirmationRow } from "@/types/cod";

/**
 * COD order detail.
 *
 * New in this pass — the section previously had no detail view at all, so the
 * confirmation calls it places were invisible: `calls.cod_confirmation_id` has
 * existed since the feature shipped and nothing read it.
 *
 * Same chassis, same field layout and the same call rail + pane as the lead
 * sheet and cart recovery.
 */
export function CodConfirmationDetail({
  order,
  open,
  onOpenChange,
}: {
  order: CodConfirmationRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [calls, setCalls] = React.useState<CodCallRow[] | null>(null);
  const [selectedCallId, setSelectedCallId] = React.useState<string | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const now = useClientNow();

  const orderId = order?.id ?? null;
  React.useEffect(() => {
    if (!open || !orderId) return;
    let cancelled = false;
    (async () => {
      setError(null);
      setCalls(null);
      setSelectedCallId(null);
      const result = await getCodCallsForConfirmation(orderId);
      if (cancelled) return;
      if (!result.success) {
        setError(result.error);
        setCalls([]);
        return;
      }
      setCalls(result.data);
      // Preselect the newest attempt so the pane is never empty on arrival.
      setSelectedCallId(result.data[0]?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, orderId]);

  if (!order) return null;

  const outcome = codOutcome(order);
  const customer = order.customer_name ?? order.order_name ?? "COD order";

  const timeline: TimelineEvent[] = [
    {
      label: "Order placed",
      at: order.created_at,
      display: formatDateTime(order.created_at),
    },
    {
      label: "Reached the customer",
      at: order.connected_at,
      display: formatDateTime(order.connected_at),
      hint:
        order.confirmed === null
          ? undefined
          : order.confirmed
            ? "The customer confirmed they want the order."
            : "The customer declined or was unsure — treat as at-risk before dispatch.",
    },
    {
      label: "Next attempt",
      at: order.status === "pending" ? order.next_attempt_at : null,
      display: formatDateTime(order.next_attempt_at),
      upcoming: true,
    },
  ];

  return (
    <DetailSheetShell
      open={open}
      onOpenChange={onOpenChange}
      width="lg"
      title={customer}
      description="COD order confirmation details"
      subtitle={
        <span className="font-mono tabular-nums">
          {order.phone ?? "no phone"}
        </span>
      }
      pills={
        <>
          <Badge variant={outcome.variant}>{outcome.label}</Badge>
          {order.skip_reason ? (
            <span className="text-[11px] text-muted-foreground">
              {order.skip_reason.replace(/_/g, " ")}
            </span>
          ) : null}
        </>
      }
      tabs={[
        { value: "summary", label: "Summary" },
        { value: "calls", label: "Calls", count: calls?.length },
      ]}
    >
      <DetailSheetPanel value="summary">
        <DetailPanel title="Order">
          <DescriptionList
            columns={2}
            items={[
              { label: "Order", value: order.order_name, mono: true },
              {
                label: "Value",
                value: formatMoney(order.order_total, order.currency),
              },
              { label: "Payment gateway", value: order.gateway },
              {
                label: "Attempts",
                value: `${order.attempt}/${order.max_attempts}`,
              },
              {
                label: "Confirmed",
                // `false` is a real answer — the customer said no — so this is
                // an explicit null check, never a falsy one.
                value:
                  order.confirmed === null
                    ? null
                    : order.confirmed
                      ? "Yes"
                      : "No",
              },
              { label: "Last dial result", value: order.last_status },
            ]}
          />
        </DetailPanel>

        <DetailPanel title="Lifecycle">
          <DetailTimeline events={timeline} />
        </DetailPanel>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </DetailSheetPanel>

      {/* `fill`: the split view scrolls each side itself. */}
      <DetailSheetPanel value="calls" fill>
        <CallSplitView
          calls={calls}
          selectedId={selectedCallId}
          onSelect={setSelectedCallId}
          counterpartyName={order.customer_name}
          now={now}
          railLabel="Confirmation calls"
          emptyLabel="No confirmation calls placed for this order yet."
        />
      </DetailSheetPanel>
    </DetailSheetShell>
  );
}
