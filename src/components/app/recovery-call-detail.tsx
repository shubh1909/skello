"use client";

import { CallDetailPane } from "@/components/app/call-detail";
import { CallStatusBadge } from "@/components/app/recovery-badges";
import {
  DescriptionList,
  DetailPanel,
  DetailSheetBody,
  DetailSheetShell,
} from "@/components/app/detail-sheet";
import { useClientNow } from "@/hooks/use-client-now";
import { formatMoney, productsSummary } from "@/lib/format/recovery";
import type { RecoveryCallRow } from "@/types/shopify";

/**
 * One recovery call, opened from the workspace's own Calls table.
 *
 * The cart sheet no longer stacks this on top of itself — it has an in-sheet
 * rail and pane instead. This route survives because the Calls tab lists calls
 * across *every* cart, where there is no parent sheet to embed in.
 *
 * The body is `CallDetailPane`, the same component the lead sheet and the cart
 * sheet render, so the three surfaces cannot drift. Only the cart context below
 * is specific to this one.
 */
export function RecoveryCallDetail({
  call,
  open,
  onOpenChange,
}: {
  call: RecoveryCallRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const now = useClientNow();
  if (!call) return null;

  const shopper = call.customer_name ?? call.lead_name ?? "Unknown shopper";
  const products = productsSummary(call.cart_items);

  return (
    <DetailSheetShell
      open={open}
      onOpenChange={onOpenChange}
      width="lg"
      // A left arrow, not an X: this opened from a list, so dismissing returns
      // you somewhere specific.
      dismiss="back"
      title={shopper}
      description="Recovery call details"
      subtitle={
        <span className="font-mono tabular-nums">
          {call.to_phone ?? "no phone"}
        </span>
      }
      pills={<CallStatusBadge status={call.status} />}
    >
      <DetailSheetBody className="gap-0 p-0">
        <CallDetailPane call={call} counterpartyName={shopper} now={now} />

        <div className="flex flex-col gap-4 px-5 pb-5">
          <DetailPanel title="Cart & lead">
            <DescriptionList
              omitEmpty
              columns={2}
              items={[
                {
                  label: "Cart value",
                  value: formatMoney(call.cart_total, call.currency),
                },
                { label: "Lead status", value: call.lead_status },
                { label: "Lead intent", value: call.lead_intent },
                { label: "Products", value: products.full, span: "full" },
              ]}
            />
          </DetailPanel>
        </div>
      </DetailSheetBody>
    </DetailSheetShell>
  );
}
