"use client";

import * as React from "react";
import Link from "next/link";
import {
  ExternalLinkIcon,
  Loader2Icon,
  PhoneIncomingIcon,
  PhoneOutgoingIcon,
} from "lucide-react";
import { toast } from "sonner";

import { listCallTranscript } from "@/actions/call-transcripts";
import { CallStatusBadge } from "@/components/app/recovery-badges";
import {
  DescriptionList,
  DetailPanel,
  PanelProse,
} from "@/components/app/detail-sheet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { transcriptEmptyCopy } from "@/lib/calls/labels";
import { formatDurationCompact } from "@/lib/format/duration";
import { formatDateTime, formatRelative } from "@/lib/format";
import {
  CALL_LEAD_DATA_SURFACED,
  buildCustomFieldGroups,
  pickLeadDataExtras,
} from "@/lib/leads/captured-fields";
import { intentBadge } from "@/lib/leads/intent";
import { cn } from "@/lib/utils";
import type { CallTranscriptTurn } from "@/types/call-transcript";

import { CapturedFieldGroups } from "./captured-field-groups";
import { TranscriptBody } from "./transcript-body";
import type { CallPaneCall } from "./types";

/**
 * One call, rendered in full.
 *
 * This existed **three times** before — inside the lead sheet, as the whole of
 * `recovery-call-detail.tsx`, and again in `call-transcript-dialog.tsx` — all
 * rendering the same `calls` row in the same order in three different visual
 * languages. It is now one component, and cart recovery and COD get the lead
 * sheet's version rather than a thinner cousin.
 *
 * It fetches its own transcript turns, keyed on the call id, so switching rows
 * in the rail never refetches the surrounding list.
 */
export function CallDetailPane({
  call,
  counterpartyName,
  now,
  className,
}: {
  call: CallPaneCall;
  /** Shown beside the number — the lead's or shopper's name, when known. */
  counterpartyName?: string | null;
  /** From `useClientNow()`. `null` until hydration, which suppresses the diff. */
  now?: number | null;
  className?: string;
}) {
  const [turns, setTurns] = React.useState<CallTranscriptTurn[] | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setTurns(null);
    if (call.transcript_status !== "ready") {
      // Nothing to fetch — the raw blob or the empty copy covers it.
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    (async () => {
      const result = await listCallTranscript({ call_id: call.id });
      if (cancelled) return;
      setLoading(false);
      if (!result.success) {
        toast.error(result.error);
        setTurns([]);
        return;
      }
      setTurns(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [call.id, call.transcript_status]);

  const inbound = call.direction === "inbound";
  const DirectionIcon = inbound ? PhoneIncomingIcon : PhoneOutgoingIcon;
  const counterparty = inbound ? call.from_phone : call.to_phone;
  const duration = formatDurationCompact(call.duration_seconds, { empty: "" });
  const intent = intentBadge(call.lead_intent_extracted);
  const leadIntent = intentBadge(call.lead_intent);
  const hasLead = Boolean(
    call.lead_name || call.lead_status || call.lead_intent,
  );

  // A dial that never connected is the single most important thing on the
  // screen. It used to be a hover-only tooltip on an (i) icon.
  const failed = call.status === "failed" || Boolean(call.error_message);

  const extraLeadData = pickLeadDataExtras(
    call.lead_data,
    CALL_LEAD_DATA_SURFACED,
  );
  const extraGroups = buildCustomFieldGroups(call.custom_data, extraLeadData);

  return (
    <article className={cn("flex flex-col gap-4 p-5", className)}>
      <header className="flex flex-col gap-2 border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            <DirectionIcon className="size-3" />
            {inbound ? "Inbound" : "Outbound"}
          </Badge>
          <CallStatusBadge status={call.status} />
          {call.call_outcome ? (
            <Badge variant="outline">{call.call_outcome}</Badge>
          ) : null}
          {duration ? (
            <span className="text-xs text-muted-foreground">· {duration}</span>
          ) : null}
          <span
            className="ml-auto text-xs text-muted-foreground"
            suppressHydrationWarning
          >
            {now == null ? "" : formatRelative(call.started_at, now)}
          </span>
        </div>
        <p className="font-mono text-sm tabular-nums">
          {counterparty ?? "Unknown number"}
          {counterpartyName ? (
            <span className="ml-2 font-sans text-muted-foreground">
              · {counterpartyName}
            </span>
          ) : null}
        </p>
      </header>

      {failed ? (
        <Alert variant="destructive">
          <AlertTitle>
            {call.bolna_call_id
              ? "The call failed at the telephony layer"
              : "The call was never placed"}
          </AlertTitle>
          <AlertDescription>
            {call.bolna_call_id
              ? "The dial was accepted but the carrier couldn't connect or route the number."
              : "The voice provider rejected the request."}
            {call.error_message ? (
              <span className="mt-1.5 block rounded bg-muted/60 p-1.5 font-mono text-xs wrap-break-word">
                {call.error_message}
              </span>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {call.recording_url ? (
        <DetailPanel title="Recording">
          <audio
            controls
            preload="none"
            src={call.recording_url}
            className="w-full"
          >
            <track kind="captions" />
          </audio>
        </DetailPanel>
      ) : null}

      <DetailPanel title="Timing">
        <DescriptionList
          columns={2}
          items={[
            { label: "Started", value: formatDateTime(call.started_at) },
            { label: "Answered", value: formatDateTime(call.answered_at) },
            { label: "Ended", value: formatDateTime(call.ended_at) },
            {
              label: "Duration",
              value: formatDurationCompact(call.duration_seconds),
            },
          ]}
        />
      </DetailPanel>

      {call.summary ? (
        <DetailPanel title="Summary">
          <PanelProse>{call.summary}</PanelProse>
        </DetailPanel>
      ) : null}

      {call.actionable ? (
        <DetailPanel title="Actionable next step" tone="attention">
          {call.actionable}
        </DetailPanel>
      ) : null}

      {/* The lead as it stands NOW — deliberately separate from "Captured on
          this call" below, which is the immutable snapshot of what this one
          conversation extracted. A later call can have moved the lead on, and
          collapsing the two would make a stale extraction look current. */}
      {hasLead ? (
        <DetailPanel
          title="Lead"
          action={
            counterparty ? (
              <Button
                variant="ghost"
                size="xs"
                render={
                  // The leads table opens its sheet from client state, so there
                  // is no `?lead=<id>` to link to. `?q=` filters the table down
                  // to this person — the same deep link ⌘K uses.
                  <Link
                    href={`/leads?include=all&q=${encodeURIComponent(counterparty)}`}
                  />
                }
              >
                Open in Leads
                <ExternalLinkIcon />
              </Button>
            ) : null
          }
        >
          <DescriptionList
            omitEmpty
            columns={2}
            items={[
              { label: "Name", value: call.lead_name },
              { label: "Pipeline status", value: call.lead_status },
              {
                label: "Current intent",
                value: leadIntent ? (
                  <Badge variant={leadIntent.variant}>{leadIntent.label}</Badge>
                ) : null,
              },
            ]}
          />
        </DetailPanel>
      ) : null}

      <DetailPanel title="Captured on this call">
        <DescriptionList
          omitEmpty
          items={[
            { label: "Name", value: call.name_extracted },
            { label: "Interest", value: call.interest },
            {
              label: "Intent",
              value: intent ? (
                <Badge variant={intent.variant}>{intent.label}</Badge>
              ) : null,
            },
            { label: "Buyer type", value: call.customer_status },
            {
              label: "Callback requested",
              value: formatDateTime(call.requested_callback_at),
            },
            {
              label: "Visit scheduled",
              value: formatDateTime(call.visit_scheduled_at),
            },
            {
              label: "WhatsApp opt-in",
              // Explicitly not `call.connect_on_whatsapp ? …` — false is a real
              // answer ("they declined"), and a falsy check would hide it.
              value:
                call.connect_on_whatsapp === null
                  ? null
                  : call.connect_on_whatsapp
                    ? "Yes"
                    : "No",
            },
          ]}
        />
      </DetailPanel>

      {extraGroups.length > 0 ? (
        <DetailPanel title="Additional fields">
          <CapturedFieldGroups groups={extraGroups} bare />
        </DetailPanel>
      ) : null}

      <DetailPanel title="Transcript">
        {loading && turns === null ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Loading transcript…
          </div>
        ) : turns && turns.length > 0 ? (
          <TranscriptBody turns={turns} />
        ) : call.transcript ? (
          <pre className="whitespace-pre-wrap text-xs leading-relaxed">
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
          <p className="text-sm italic text-muted-foreground">
            {transcriptEmptyCopy(call.transcript_status)}
          </p>
        )}
      </DetailPanel>
    </article>
  );
}
