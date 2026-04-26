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

  React.useEffect(() => {
    if (!open || !call) {
      setTurns(null);
      return;
    }
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
