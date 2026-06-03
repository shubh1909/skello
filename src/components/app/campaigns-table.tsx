"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  DownloadIcon,
  ListIcon,
  PlayIcon,
  RadioIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CampaignCallLogSheet } from "@/components/app/campaign-call-log-sheet";
import { InfiniteScrollFooter } from "@/components/app/infinite-scroll-footer";
import {
  deleteCampaign,
  listCampaigns,
  runCampaignNow,
  stopCampaign,
} from "@/actions/campaigns";
import { useCampaignsRealtime } from "@/hooks/use-campaigns-realtime";
import { useClientNow } from "@/hooks/use-client-now";
import { useInfiniteList } from "@/hooks/use-infinite-list";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Campaign, CampaignStatus } from "@/types/campaign";

const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  in_progress: "Running",
  paused: "Paused",
  stopped: "Stopped",
  completed: "Completed",
  failed: "Failed",
};

// A campaign's stored status can lag behind reality: the DB only flips
// in_progress → completed via a trigger, and a lost result webhook can leave
// it "Running" after every contact has actually resolved. The dispatch tick
// reconciles this server-side, but the UI shouldn't show a stale "Running"
// in the meantime. If a campaign reads in_progress yet has nothing left to
// process (no in-flight calls and the finished count covers every contact),
// display it as "Wrapping up" so the operator knows it's effectively done.
function displayStatus(c: Campaign): { label: string; className: string } {
  const finished = c.succeeded_count + c.failed_count;
  const allResolved =
    c.in_flight_count === 0 &&
    c.total_contacts > 0 &&
    finished >= c.total_contacts;
  if (c.status === "in_progress" && allResolved) {
    return { label: "Wrapping up", className: STATUS_CLASS.completed };
  }
  return { label: STATUS_LABEL[c.status], className: STATUS_CLASS[c.status] };
}

const STATUS_CLASS: Record<CampaignStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  scheduled:
    "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  in_progress:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  paused: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  stopped: "bg-muted text-foreground",
  completed: "bg-muted text-foreground",
  failed: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};

interface CampaignsTableProps {
  rows: Campaign[];
  total: number;
  pageSize: number;
  organisationId: string;
}

export function CampaignsTable({
  rows,
  total,
  pageSize,
  organisationId,
}: CampaignsTableProps) {
  const router = useRouter();
  const now = useClientNow();

  const fetchPage = React.useCallback(
    async (offset: number, limit: number) => {
      const res = await listCampaigns({
        organisation_id: organisationId,
        limit,
        offset,
      });
      if (!res.success) {
        toast.error(res.error);
        return null;
      }
      return res.data;
    },
    [organisationId],
  );

  const {
    items,
    total: liveTotal,
    loading,
    hasMore,
    pagedBeyondInitial,
    sentinelRef,
  } = useInfiniteList<Campaign>({
    initialItems: rows,
    initialTotal: total,
    pageSize,
    fetchPage,
  });

  useCampaignsRealtime(organisationId, pagedBeyondInitial);

  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [logCampaignId, setLogCampaignId] = React.useState<string | null>(null);
  const [logOpen, setLogOpen] = React.useState(false);

  function openCallLog(c: Campaign) {
    setLogCampaignId(c.id);
    setLogOpen(true);
  }

  function onRunNow(c: Campaign) {
    setPendingId(c.id);
    startTransition(async () => {
      const res = await runCampaignNow({ id: c.id });
      setPendingId(null);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Campaign started");
      router.refresh();
    });
  }

  function onStop(c: Campaign) {
    if (!confirm(`Stop campaign "${c.name}"? Pending dials will be skipped.`)) {
      return;
    }
    setPendingId(c.id);
    startTransition(async () => {
      const res = await stopCampaign({ id: c.id });
      setPendingId(null);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Campaign stopped");
      router.refresh();
    });
  }

  function onDelete(c: Campaign) {
    if (
      !confirm(
        `Delete campaign "${c.name}"? Contacts will be removed; call history is preserved.`,
      )
    ) {
      return;
    }
    setPendingId(c.id);
    startTransition(async () => {
      const res = await deleteCampaign({ id: c.id });
      setPendingId(null);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Campaign removed");
      router.refresh();
    });
  }

  function onDownload(c: Campaign) {
    const a = document.createElement("a");
    a.href = `/api/campaigns/${c.id}/export`;
    a.click();
  }

  const logCampaign = React.useMemo(
    () => items.find((r) => r.id === logCampaignId) ?? null,
    [items, logCampaignId],
  );

  if (items.length === 0) {
    return (
      <Card className="items-center gap-3 py-24 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-muted">
          <RadioIcon className="size-6 text-muted-foreground" />
        </span>
        <p className="text-base font-medium">No campaigns yet</p>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          Upload a CSV of phone numbers to start a bulk outbound run. Skelo
          will dial each one and retry failures based on your rules.
        </p>
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-260 text-left text-sm">
            <thead className="border-b border-border/60 bg-muted/30">
              <tr className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th scope="col" className="px-5 py-4 font-medium">ID</th>
                <th scope="col" className="px-3 py-4 font-medium">File</th>
                <th scope="col" className="px-3 py-4 font-medium">Contacts</th>
                <th scope="col" className="px-3 py-4 font-medium">Status</th>
                <th scope="col" className="px-4 py-4 font-medium">Progress</th>
                <th scope="col" className="px-3 py-4 font-medium">Created</th>
                <th scope="col" className="px-5 py-4 text-right font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {items.map((c) => {
                const isBusy = pending && pendingId === c.id;
                const canRun =
                  c.status === "scheduled" ||
                  c.status === "stopped" ||
                  c.status === "paused" ||
                  c.status === "completed";
                const canStop = c.status === "in_progress";
                const total = Math.max(1, c.total_contacts);
                const succeededPct = Math.round((c.succeeded_count / total) * 100);
                const failedPct = Math.round((c.failed_count / total) * 100);
                const inFlightPct = Math.round((c.in_flight_count / total) * 100);
                // Whatever's left is "not yet attempted" (pending/queued). The
                // bar shows it as the empty remainder; we surface the number so
                // the operator can see how much of the list is still to dial.
                const finishedCount = c.succeeded_count + c.failed_count;
                const remainingCount = Math.max(
                  0,
                  c.total_contacts - finishedCount - c.in_flight_count,
                );
                const donePct = Math.min(
                  100,
                  Math.round((finishedCount / total) * 100),
                );

                return (
                  <tr key={c.id} className="align-top hover:bg-muted/20">
                    <td className="px-5 py-4">
                      <button
                        type="button"
                        onClick={() => openCallLog(c)}
                        className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
                        title="Open call log"
                      >
                        {c.id.slice(0, 8)}
                      </button>
                      <p className="mt-0.5 line-clamp-1 text-sm font-medium">
                        {c.name}
                      </p>
                    </td>
                    <td className="px-3 py-4">
                      <p className="line-clamp-1 max-w-[180px] text-xs text-muted-foreground">
                        {c.file_name ?? "—"}
                      </p>
                    </td>
                    <td className="px-3 py-4 text-xs tabular-nums">
                      <span className="font-medium text-foreground">
                        {c.valid_contacts}
                      </span>
                      <span className="text-muted-foreground"> / {c.total_contacts}</span>
                    </td>
                    <td className="px-3 py-4">
                      {(() => {
                        const s = displayStatus(c);
                        return <Badge className={s.className}>{s.label}</Badge>;
                      })()}
                    </td>
                    <td className="px-4 py-4 min-w-55">
                      <div className="flex items-center justify-between text-[11px] tabular-nums">
                        <span className="font-medium text-foreground">
                          {donePct}% done
                        </span>
                        <span className="text-muted-foreground">
                          {finishedCount} / {c.total_contacts}
                        </span>
                      </div>
                      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div className="flex h-full">
                          <span
                            className="bg-emerald-500/80"
                            style={{ width: `${succeededPct}%` }}
                            title={`${c.succeeded_count} connected`}
                          />
                          <span
                            className="bg-red-500/70"
                            style={{ width: `${failedPct}%` }}
                            title={`${c.failed_count} failed`}
                          />
                          <span
                            className="animate-pulse bg-blue-500/70"
                            style={{ width: `${inFlightPct}%` }}
                            title={`${c.in_flight_count} dialing`}
                          />
                        </div>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] tabular-nums text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <span className="size-1.5 rounded-full bg-emerald-500/80" />
                          {c.succeeded_count} connected
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="size-1.5 rounded-full bg-red-500/70" />
                          {c.failed_count} failed
                        </span>
                        {c.in_flight_count > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="size-1.5 rounded-full bg-blue-500/70" />
                            {c.in_flight_count} dialing
                          </span>
                        ) : null}
                        {remainingCount > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                            {remainingCount} to go
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td
                      className="px-3 py-4 text-xs text-muted-foreground"
                      suppressHydrationWarning
                    >
                      {now === null ? "—" : formatRelative(c.created_at, now)}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => onRunNow(c)}
                          disabled={isBusy || !canRun}
                          aria-label="Run now"
                          title={canRun ? "Run now" : "Already running"}
                        >
                          <PlayIcon />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => onStop(c)}
                          disabled={isBusy || !canStop}
                          aria-label="Stop"
                          title={canStop ? "Stop" : "Not running"}
                        >
                          <SquareIcon />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => onDownload(c)}
                          aria-label="Download results"
                          title="Download results CSV"
                        >
                          <DownloadIcon />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => openCallLog(c)}
                          aria-label="Call log"
                          title="Call log"
                        >
                          <ListIcon />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => onDelete(c)}
                          disabled={isBusy}
                          aria-label="Delete"
                          title="Delete campaign"
                          className={cn(
                            "text-muted-foreground hover:text-destructive",
                          )}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
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

      <CampaignCallLogSheet
        campaignId={logCampaignId}
        campaignName={logCampaign?.name ?? null}
        open={logOpen}
        onOpenChange={setLogOpen}
      />
    </>
  );
}
