"use client";

import * as React from "react";
import {
  FileTextIcon,
  Loader2Icon,
  PhoneIncomingIcon,
  PhoneOutgoingIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listCallTranscript } from "@/actions/call-transcripts";
import { cn } from "@/lib/utils";
import type { Call } from "@/types/call";
import type {
  CallTranscriptTurn,
  CallTurnSpeaker,
} from "@/types/call-transcript";

interface CallTranscriptDialogProps {
  call: Call | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

const SPEAKER_LABEL: Record<CallTurnSpeaker, string> = {
  agent: "Agent",
  user: "Caller",
  system: "System",
};

export function CallTranscriptDialog({
  call,
  open,
  onOpenChange,
}: CallTranscriptDialogProps) {
  const [turns, setTurns] = React.useState<CallTranscriptTurn[] | null>(null);
  const [loading, setLoading] = React.useState(false);

  // Reset transcript state when the dialog's target call changes. Done during
  // render via the "store previous value" pattern React endorses, rather than
  // a setState inside the effect (which triggers a cascading render). React
  // re-renders synchronously without committing the in-between UI.
  const targetCallId = open && call ? call.id : null;
  const [trackedCallId, setTrackedCallId] = React.useState<string | null>(
    targetCallId,
  );
  if (trackedCallId !== targetCallId) {
    setTrackedCallId(targetCallId);
    setTurns(null);
    setLoading(false);
  }

  React.useEffect(() => {
    if (!open || !call) return;
    let cancelled = false;
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
  }, [open, call]);

  const DirectionIcon =
    call?.direction === "inbound" ? PhoneIncomingIcon : PhoneOutgoingIcon;
  const directionLabel = call?.direction === "inbound" ? "Inbound" : "Outbound";
  const phone =
    call?.direction === "inbound" ? call?.from_phone : call?.to_phone;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] sm:max-w-2xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border/60 p-5">
          <DialogTitle className="flex items-center gap-2">
            <FileTextIcon className="size-4 text-muted-foreground" />
            Call transcript
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2 pt-1 text-xs">
            {call ? (
              <>
                <Badge variant="outline">
                  <DirectionIcon className="size-3" /> {directionLabel}
                </Badge>
                {phone ? (
                  <span className="font-mono tabular-nums text-foreground">
                    {phone}
                  </span>
                ) : null}
                {typeof call.duration_seconds === "number" ? (
                  <span className="text-muted-foreground">
                    · {formatDuration(call.duration_seconds)}
                  </span>
                ) : null}
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {call ? <CapturedDetails call={call} /> : null}

          <h3 className="mb-2 mt-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Transcript
          </h3>
          {loading && turns === null ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              Loading transcript…
            </div>
          ) : turns && turns.length > 0 ? (
            <TranscriptBody turns={turns} />
          ) : call?.transcript ? (
            <pre className="whitespace-pre-wrap rounded-md border border-border/60 bg-muted/30 p-3 text-xs leading-relaxed">
              {call.transcript}
            </pre>
          ) : (
            <EmptyState status={call?.transcript_status ?? "pending"} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Surfaces everything the call captured beyond the transcript: the AI
// summary, the structured fields extracted from the conversation, any extra
// lead_data / custom_data keys, and the recording. Same data the lead detail
// sheet shows, but scoped to this single call's immutable snapshot.
function CapturedDetails({ call }: { call: Call }) {
  const fields: Array<{ label: string; value: React.ReactNode }> = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value && String(value).trim() !== "") fields.push({ label, value });
  };

  push("Name", call.name_extracted);
  push("Interest", call.interest);
  push("Intent", call.lead_intent_extracted);
  push("Customer status", call.customer_status);
  push("Next action", call.actionable);
  if (call.visit_scheduled_at) {
    push("Visit scheduled", formatTimestamp(call.visit_scheduled_at));
  }
  if (call.connect_on_whatsapp !== null) {
    push("Wants WhatsApp", call.connect_on_whatsapp ? "Yes" : "No");
  }
  push("Language", call.language);

  // Any other extracted keys not already promoted to a column above.
  const extra = flattenExtracted(call);

  const hasAnything =
    !!call.summary || fields.length > 0 || extra.length > 0 || !!call.recording_url;
  if (!hasAnything) return null;

  return (
    <div className="mb-4 flex flex-col gap-4">
      {call.recording_url ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Recording
          </h3>
          <audio
            src={call.recording_url}
            controls
            preload="metadata"
            className="w-full"
          />
        </div>
      ) : null}

      {call.summary ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Summary
          </h3>
          <p className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm leading-relaxed">
            {call.summary}
          </p>
        </div>
      ) : null}

      {fields.length > 0 || extra.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Captured details
          </h3>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
            {[...fields, ...extra].map((f) => (
              <div key={f.label} className="flex flex-col">
                <dt className="text-[11px] text-muted-foreground">{f.label}</dt>
                <dd className="text-sm font-medium break-words">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

// Pull scalar values out of lead_data + custom_data that aren't already shown
// as a first-class field above. Keeps the dialog generic across sectors —
// whatever the agent extracted shows up here.
// Keys already promoted to first-class fields above — don't repeat them in
// the generic "captured details" grid.
const PROMOTED_KEYS = new Set([
  "name",
  "interest",
  "product",
  "lead_intent",
  "customer_status",
  "actionable",
  "date_and_time_of_visit",
  "connect_on_whatsapp",
  "business_slug",
]);

function flattenExtracted(
  call: Call,
): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  const seen = new Set<string>(PROMOTED_KEYS);
  const add = (rawKey: string, raw: unknown) => {
    if (raw === null || raw === undefined) return;
    if (typeof raw === "object") return; // skip nested blobs
    const value = String(raw).trim();
    if (!value) return;
    const key = rawKey.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label: humanise(rawKey), value });
  };

  // lead_data first (the canonical category), then custom_data buckets.
  for (const [k, v] of Object.entries(call.lead_data ?? {})) add(k, v);
  for (const bag of Object.values(call.custom_data ?? {})) {
    if (bag && typeof bag === "object") {
      for (const [k, v] of Object.entries(bag)) add(k, v);
    }
  }
  return out;
}

function humanise(key: string): string {
  return key
    .split(/[_\s]+/)
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function TranscriptBody({ turns }: { turns: CallTranscriptTurn[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {turns.map((t) => {
        const isAgent = t.speaker === "agent";
        const isUser = t.speaker === "user";
        return (
          <li
            key={t.id}
            className={cn(
              "flex flex-col gap-1",
              isUser ? "items-end" : "items-start",
            )}
          >
            <span className="px-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              {SPEAKER_LABEL[t.speaker]}
            </span>
            <div
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                isAgent
                  ? "rounded-tl-sm bg-muted text-foreground"
                  : isUser
                    ? "rounded-tr-sm bg-primary text-primary-foreground"
                    : "rounded-md bg-muted/60 text-muted-foreground italic",
              )}
            >
              {t.text}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function EmptyState({ status }: { status: string }) {
  const copy: Record<string, string> = {
    pending: "Transcript hasn't been fetched yet — check back in a moment.",
    processing: "Transcript is being processed.",
    failed: "We couldn't fetch this transcript. You can retry from the call row.",
    skipped: "No transcript was produced for this call.",
    ready: "This call has no utterances on file.",
  };
  return (
    <div className="flex flex-col items-center gap-1 py-10 text-center">
      <p className="text-sm font-medium">No transcript to show</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        {copy[status] ?? copy.pending}
      </p>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}
