"use client";

import * as React from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  PhoneIcon,
  PlayIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CallTranscriptDialog } from "@/components/app/call-transcript-dialog";
import { useCallsRealtime } from "@/hooks/use-calls-realtime";
import type { Call, CallStatus, CallWithLead } from "@/types/call";

const OUTCOME_LABEL: Record<CallStatus, string> = {
  initiated: "Dialling",
  ringing: "Ringing",
  in_progress: "Live",
  completed: "Completed",
  failed: "Failed",
  no_answer: "No answer",
  busy: "Busy",
  canceled: "Canceled",
};

const OUTCOME_VARIANT: Record<
  CallStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  initiated: "outline",
  ringing: "outline",
  in_progress: "default",
  completed: "secondary",
  failed: "destructive",
  no_answer: "outline",
  busy: "outline",
  canceled: "outline",
};

function shortCallId(id: string): string {
  // Stable 6-char suffix from the UUID, uppercased.
  const compact = id.replace(/-/g, "");
  return `CL-${compact.slice(-6).toUpperCase()}`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export function ConversationsTable({
  calls,
  organisationId,
}: {
  calls: CallWithLead[];
  organisationId: string;
}) {
  useCallsRealtime(organisationId);
  const [transcriptCall, setTranscriptCall] = React.useState<Call | null>(null);
  const [transcriptOpen, setTranscriptOpen] = React.useState(false);

  function openTranscript(call: Call) {
    setTranscriptCall(call);
    setTranscriptOpen(true);
  }

  if (calls.length === 0) {
    return (
      <Card className="items-center gap-3 py-16 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-muted">
          <PhoneIcon className="size-5 text-muted-foreground" />
        </span>
        <p className="font-medium">No conversations yet</p>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          Inbound and outbound calls placed by your voice agent will show up
          here. Adjust the filters above if you expected to see results.
        </p>
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border/60 bg-muted/30">
              <tr className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th scope="col" className="px-4 py-3 font-medium">
                  Call ID
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Lead / Number
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  <span className="inline-flex items-center gap-1">
                    Date &amp; Time
                    <ArrowDownIcon className="size-3" />
                  </span>
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Duration
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Direction
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Outcome
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Audio
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {calls.map((call) => {
                const inbound = call.direction === "inbound";
                const counterparty = inbound ? call.from_phone : call.to_phone;
                const phone = call.lead?.phone ?? counterparty ?? null;
                const name = call.lead?.name ?? null;
                const hasTranscript =
                  call.transcript_status === "ready" || !!call.transcript;
                const hasRecording = !!call.recording_url;

                return (
                  <tr
                    key={call.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open transcript for ${shortCallId(call.id)}`}
                    onClick={() => openTranscript(call)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openTranscript(call);
                      }
                    }}
                    className="group cursor-pointer align-middle transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                  >
                    <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground">
                      {shortCallId(call.id)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">
                          {name ?? "Unknown"}
                        </span>
                        {phone ? (
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {phone}
                          </span>
                        ) : (
                          <span className="text-xs italic text-muted-foreground">
                            No phone
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDateTime(call.started_at)}
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-muted-foreground">
                      {formatDuration(call.duration_seconds)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">
                        {inbound ? (
                          <ArrowDownIcon className="size-3" />
                        ) : (
                          <ArrowUpIcon className="size-3" />
                        )}
                        {inbound ? "Inbound" : "Outbound"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={OUTCOME_VARIANT[call.status]}>
                        {OUTCOME_LABEL[call.status]}
                      </Badge>
                    </td>
                    <td
                      className="px-4 py-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {hasRecording ? (
                        <Button
                          render={
                            <a
                              href={call.recording_url ?? "#"}
                              target="_blank"
                              rel="noreferrer"
                            />
                          }
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          aria-label="Play recording"
                        >
                          <PlayIcon className="size-3" /> Play
                        </Button>
                      ) : hasTranscript ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => openTranscript(call)}
                        >
                          Transcript
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <CallTranscriptDialog
        call={transcriptCall}
        open={transcriptOpen}
        onOpenChange={setTranscriptOpen}
      />
    </>
  );
}
