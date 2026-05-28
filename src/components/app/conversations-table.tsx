"use client";

import * as React from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronsUpDownIcon,
  PhoneIcon,
  PlayIcon,
} from "lucide-react";

import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CallTranscriptDialog } from "@/components/app/call-transcript-dialog";
import { InfiniteScrollFooter } from "@/components/app/infinite-scroll-footer";
import { listConversations } from "@/actions/calls";
import { cn } from "@/lib/utils";
import { useCallsRealtime } from "@/hooks/use-calls-realtime";
import {
  ColumnResizeHandle,
  useColumnWidths,
} from "@/hooks/use-column-widths";
import { useInfiniteList } from "@/hooks/use-infinite-list";
import type {
  Call,
  CallDirection,
  CallStatus,
  CallWithLead,
} from "@/types/call";

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

type SortField =
  | "started_at"
  | "duration_seconds"
  | "status"
  | "direction";

interface SortState {
  field: SortField;
  dir: "asc" | "desc";
}

// Labels shown in the column header — the SortField key matches the wire
// param consumed by listConversations. Default widths are tuned to the
// rendered content (short call IDs, compact duration strings, etc.) so
// the table looks right before the user touches anything; the resize
// handles let them override per-column afterwards.
const SORTABLE_HEADERS: {
  field: SortField;
  label: string;
  defaultWidth: number;
}[] = [
  { field: "started_at", label: "Date & Time", defaultWidth: 170 },
  { field: "duration_seconds", label: "Duration", defaultWidth: 110 },
  { field: "direction", label: "Direction", defaultWidth: 130 },
  { field: "status", label: "Outcome", defaultWidth: 130 },
];

const COL_CALL_ID = "call_id";
const COL_LEAD = "lead";
const COL_AUDIO = "audio";
const DEFAULT_CALL_ID_WIDTH = 130;
const DEFAULT_LEAD_WIDTH = 220;
const DEFAULT_AUDIO_WIDTH = 130;

export interface ConversationsTableFilters {
  direction?: CallDirection;
  status?: CallStatus;
  agent?: string;
  from?: string;
  q?: string;
}

interface ConversationsTableProps {
  calls: CallWithLead[];
  total: number;
  pageSize: number;
  organisationId: string;
  filters: ConversationsTableFilters;
}

export function ConversationsTable({
  calls,
  total,
  pageSize,
  organisationId,
  filters,
}: ConversationsTableProps) {
  // Local sort state — null means use the server default (started_at desc),
  // which is also what the server-rendered initial page used.
  const [sort, setSort] = React.useState<SortState | null>(null);

  // Per-user column widths, persisted in localStorage and scoped by org so
  // each workspace remembers its own conversations layout independently
  // from the leads layout.
  const { widths, makeResizeStarter } = useColumnWidths(
    `conversations-table-widths:${organisationId}`,
  );
  const widthCallId = widths[COL_CALL_ID] ?? DEFAULT_CALL_ID_WIDTH;
  const widthLead = widths[COL_LEAD] ?? DEFAULT_LEAD_WIDTH;
  const widthAudio = widths[COL_AUDIO] ?? DEFAULT_AUDIO_WIDTH;
  function widthForSort(field: SortField, fallback: number): number {
    return widths[field] ?? fallback;
  }

  const fetchPage = React.useCallback(
    async (offset: number, limit: number) => {
      const res = await listConversations({
        organisation_id: organisationId,
        limit,
        offset,
        direction: filters.direction,
        status: filters.status,
        agent_id: filters.agent,
        from: filters.from,
        q: filters.q,
        sort: sort?.field,
        dir: sort?.dir,
      });
      if (!res.success) {
        toast.error(res.error);
        return null;
      }
      return res.data;
    },
    [
      organisationId,
      filters.direction,
      filters.status,
      filters.agent,
      filters.from,
      filters.q,
      sort,
    ],
  );

  const {
    items,
    total: liveTotal,
    loading,
    hasMore,
    pagedBeyondInitial,
    sentinelRef,
  } = useInfiniteList<CallWithLead>({
    initialItems: calls,
    initialTotal: total,
    pageSize,
    fetchPage,
    // Sort lives in client state — when it changes, refetch from offset 0
    // so the whole list reflects the new order instead of stitching pages
    // sorted by different keys.
    resetKey: JSON.stringify(sort),
  });

  // Click a sortable header → cycle none → desc → asc → none. New columns
  // start at desc because that's the more useful default for both dates and
  // numeric durations.
  function toggleSort(field: SortField) {
    setSort((prev) => {
      if (!prev || prev.field !== field) return { field, dir: "desc" };
      if (prev.dir === "desc") return { field, dir: "asc" };
      return null;
    });
  }

  useCallsRealtime(organisationId, pagedBeyondInitial);

  const [transcriptCall, setTranscriptCall] = React.useState<Call | null>(null);
  const [transcriptOpen, setTranscriptOpen] = React.useState(false);

  function openTranscript(call: Call) {
    setTranscriptCall(call);
    setTranscriptOpen(true);
  }

  if (items.length === 0) {
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
          <table className="w-full table-fixed text-left text-sm">
            <colgroup>
              <col style={{ width: `${widthCallId}px` }} />
              <col style={{ width: `${widthLead}px` }} />
              {SORTABLE_HEADERS.map((h) => (
                <col
                  key={h.field}
                  style={{
                    width: `${widthForSort(h.field, h.defaultWidth)}px`,
                  }}
                />
              ))}
              <col style={{ width: `${widthAudio}px` }} />
            </colgroup>
            <thead className="border-b border-border/60 bg-muted/30">
              <tr className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th
                  scope="col"
                  className="relative px-4 py-3 font-medium"
                >
                  Call ID
                  <ColumnResizeHandle
                    onStart={makeResizeStarter(COL_CALL_ID, widthCallId)}
                  />
                </th>
                <th
                  scope="col"
                  className="relative px-4 py-3 font-medium"
                >
                  Lead / Number
                  <ColumnResizeHandle
                    onStart={makeResizeStarter(COL_LEAD, widthLead)}
                  />
                </th>
                {SORTABLE_HEADERS.map((h) => (
                  <SortableHeader
                    key={h.field}
                    field={h.field}
                    label={h.label}
                    sort={sort}
                    onToggle={toggleSort}
                    onResizeStart={makeResizeStarter(
                      h.field,
                      widthForSort(h.field, h.defaultWidth),
                    )}
                  />
                ))}
                <th
                  scope="col"
                  className="relative px-4 py-3 font-medium"
                >
                  Audio
                  <ColumnResizeHandle
                    onStart={makeResizeStarter(COL_AUDIO, widthAudio)}
                  />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {items.map((call) => {
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
                      {hasRecording && call.recording_url ? (
                        <Popover>
                          <PopoverTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                aria-label="Play recording"
                              />
                            }
                          >
                            <PlayIcon className="size-3" /> Play
                          </PopoverTrigger>
                          <PopoverContent
                            align="end"
                            sideOffset={6}
                            className="w-80 p-3"
                          >
                            <div className="flex flex-col gap-2">
                              <div className="text-xs font-medium text-muted-foreground">
                                Recording · {shortCallId(call.id)}
                              </div>
                              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                              <audio
                                src={call.recording_url}
                                controls
                                preload="metadata"
                                className="w-full"
                              />
                            </div>
                          </PopoverContent>
                        </Popover>
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

      <InfiniteScrollFooter
        loading={loading}
        hasMore={hasMore}
        loadedCount={items.length}
        total={liveTotal}
        sentinelRef={sentinelRef}
      />

      <CallTranscriptDialog
        call={transcriptCall}
        open={transcriptOpen}
        onOpenChange={setTranscriptOpen}
      />
    </>
  );
}

function SortableHeader({
  field,
  label,
  sort,
  onToggle,
  onResizeStart,
}: {
  field: SortField;
  label: string;
  sort: SortState | null;
  onToggle: (f: SortField) => void;
  onResizeStart: (e: React.MouseEvent) => void;
}) {
  const isCurrent = sort?.field === field;
  const dir = isCurrent ? sort.dir : null;
  return (
    <th scope="col" className="relative px-4 py-3 font-medium">
      <button
        type="button"
        onClick={() => onToggle(field)}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm text-inherit transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          isCurrent && "text-foreground",
        )}
        aria-label={`Sort by ${label}`}
      >
        {label}
        {dir === "asc" ? (
          <ArrowUpIcon className="size-3" />
        ) : dir === "desc" ? (
          <ArrowDownIcon className="size-3" />
        ) : (
          <ChevronsUpDownIcon className="size-3 opacity-40" />
        )}
      </button>
      <ColumnResizeHandle onStart={onResizeStart} />
    </th>
  );
}
