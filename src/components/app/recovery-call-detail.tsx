"use client";

import { InfoIcon } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatDateTime,
  formatDuration,
  formatMoney,
  productsSummary,
} from "@/lib/format/recovery";
import type { RecoveryCallRow } from "@/types/shopify";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function jsonEntries(data: Record<string, unknown> | null): [string, string][] {
  if (!data || typeof data !== "object") return [];
  return Object.entries(data)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => [
      k,
      typeof v === "string" || typeof v === "number" || typeof v === "boolean"
        ? String(v)
        : JSON.stringify(v),
    ]);
}

export function RecoveryCallDetail({
  call,
  open,
  onOpenChange,
}: {
  call: RecoveryCallRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!call) return null;
  const shopper = call.customer_name ?? call.lead_name ?? "Unknown shopper";
  const products = productsSummary(call.cart_items);
  const extraData = [
    ...jsonEntries(call.lead_data),
    ...jsonEntries(call.custom_data),
  ];
  const isFailed = call.status === "failed" || !!call.error_message;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="gap-1 border-b">
          <SheetTitle>{shopper}</SheetTitle>
          <SheetDescription className="font-mono tabular-nums">
            {call.to_phone ?? "no phone"}
          </SheetDescription>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{call.status}</Badge>
            {isFailed ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Why it failed"
                      className="inline-flex cursor-help text-muted-foreground hover:text-foreground"
                    />
                  }
                >
                  <InfoIcon className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    {call.bolna_call_id
                      ? "The call was placed but failed at the telephony layer (carrier couldn't connect / route the number)."
                      : "The call was never placed — the voice provider rejected the request."}
                  </p>
                  {call.error_message ? (
                    <p className="mt-1.5 rounded bg-muted/60 p-1.5 font-mono wrap-break-word">
                      {call.error_message}
                    </p>
                  ) : null}
                </TooltipContent>
              </Tooltip>
            ) : null}
            {call.call_outcome ? (
              <Badge variant="outline">{call.call_outcome}</Badge>
            ) : null}
          </div>
        </SheetHeader>

        <div className="flex flex-col gap-5 p-4">

          {call.recording_url ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Recording
              </span>
              <audio controls preload="none" src={call.recording_url} className="w-full">
                Your browser can&apos;t play this recording.
              </audio>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Started" value={formatDateTime(call.started_at)} />
            <Field label="Answered" value={formatDateTime(call.answered_at)} />
            <Field label="Ended" value={formatDateTime(call.ended_at)} />
            <Field label="Duration" value={formatDuration(call.duration_seconds)} />
          </div>

          {call.summary ? (
            <Field label="Summary" value={call.summary} />
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Name (extracted)" value={call.name_extracted} />
            <Field label="Interest" value={call.interest} />
            <Field label="Intent" value={call.lead_intent_extracted} />
            <Field label="Buyer type" value={call.customer_status} />
            <Field
              label="Callback requested"
              value={formatDateTime(call.requested_callback_at)}
            />
            <Field
              label="Visit scheduled"
              value={formatDateTime(call.visit_scheduled_at)}
            />
            <Field
              label="WhatsApp opt-in"
              value={
                call.connect_on_whatsapp === null
                  ? null
                  : call.connect_on_whatsapp
                    ? "Yes"
                    : "No"
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-4 border-t pt-4">
            <Field label="Cart value" value={formatMoney(call.cart_total, call.currency)} />
            <Field label="Products" value={products.full || "—"} />
            <Field label="Lead status" value={call.lead_status} />
            <Field label="Lead intent" value={call.lead_intent} />
          </div>

          {extraData.length > 0 ? (
            <div className="flex flex-col gap-1.5 border-t pt-4">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Other extracted data
              </span>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
                {extraData.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="truncate">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5 border-t pt-4">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              Transcript
            </span>
            {call.transcript ? (
              <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs leading-relaxed">
                {call.transcript}
              </pre>
            ) : call.transcript_url ? (
              <a
                href={call.transcript_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary underline-offset-4 hover:underline"
              >
                Open transcript
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">
                No transcript captured yet — it appears here once the call
                completes.
              </p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
