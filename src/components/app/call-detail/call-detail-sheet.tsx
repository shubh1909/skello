"use client";

import { CallStatusBadge } from "@/components/app/recovery-badges";
import {
  DetailSheetBody,
  DetailSheetShell,
} from "@/components/app/detail-sheet";
import { useClientNow } from "@/hooks/use-client-now";

import { CallDetailPane } from "./call-detail-pane";
import type { CallPaneCall } from "./types";

/**
 * One call in a side sheet, opened from a call list.
 *
 * Replaces `CallTranscriptDialog` — a centred modal that was the **last**
 * surviving copy of the call view, and the reason a call opened from the
 * campaign call log looked nothing like the same call opened from a lead, a
 * cart or a COD order. A sheet also gives a transcript somewhere to go: a
 * centred dialog caps at viewport height and made a long conversation scroll
 * inside a box inside a box.
 *
 * Dismisses with a back arrow rather than an X: it always opens from a list, so
 * closing returns you somewhere specific.
 */
export function CallDetailSheet({
  call,
  counterpartyName,
  open,
  onOpenChange,
}: {
  call: CallPaneCall | null;
  counterpartyName?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const now = useClientNow();
  if (!call) return null;

  const counterparty =
    call.direction === "inbound" ? call.from_phone : call.to_phone;
  const title = counterpartyName ?? call.lead_name ?? counterparty ?? "Call";

  return (
    <DetailSheetShell
      open={open}
      onOpenChange={onOpenChange}
      width="lg"
      dismiss="back"
      title={title}
      description="Call details"
      subtitle={
        <span className="font-mono tabular-nums">
          {counterparty ?? "Unknown number"}
        </span>
      }
      pills={<CallStatusBadge status={call.status} />}
    >
      <DetailSheetBody className="gap-0 p-0">
        <CallDetailPane
          call={call}
          counterpartyName={counterpartyName}
          now={now}
        />
      </DetailSheetBody>
    </DetailSheetShell>
  );
}
