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
import {
  deleteCampaign,
  runCampaignNow,
  stopCampaign,
} from "@/actions/campaigns";
import { useCampaignsRealtime } from "@/hooks/use-campaigns-realtime";
import { useClientNow } from "@/hooks/use-client-now";
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
  organisationId: string;
  agentName: string | null;
}

export function CampaignsTable({
  rows,
  organisationId,
  agentName,
}: CampaignsTableProps) {
  const router = useRouter();
  const now = useClientNow();
  useCampaignsRealtime(organisationId);

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
    () => rows.find((r) => r.id === logCampaignId) ?? null,
    [rows, logCampaignId],
  );

  if (rows.length === 0) {
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
          <table className="w-full min-w-[1200px] text-left text-sm">
            <thead className="border-b border-border/60 bg-muted/30">
              <tr className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th scope="col" className="px-5 py-4 font-medium">ID</th>
                <th scope="col" className="px-3 py-4 font-medium">File</th>
                <th scope="col" className="px-3 py-4 font-medium">Contacts</th>
                <th scope="col" className="px-3 py-4 font-medium">Status</th>
                <th scope="col" className="px-4 py-4 font-medium">Progress</th>
                <th scope="col" className="px-3 py-4 font-medium">Workflow</th>
                <th scope="col" className="px-3 py-4 font-medium">Created</th>
                <th scope="col" className="px-5 py-4 text-right font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((c) => {
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
                      <Badge className={STATUS_CLASS[c.status]}>
                        {STATUS_LABEL[c.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-4 min-w-[180px]">
                      <div className="flex items-center justify-between text-[11px] tabular-nums">
                        <span className="font-medium text-foreground">
                          {c.succeeded_count}
                        </span>
                        <span className="text-muted-foreground">
                          / {c.total_contacts}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div className="flex h-full">
                          <span
                            className="bg-emerald-500/80"
                            style={{ width: `${succeededPct}%` }}
                          />
                          <span
                            className="bg-blue-500/70"
                            style={{ width: `${inFlightPct}%` }}
                          />
                          <span
                            className="bg-red-500/70"
                            style={{ width: `${failedPct}%` }}
                          />
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
                        {c.in_flight_count > 0 ? (
                          <span>{c.in_flight_count} in flight</span>
                        ) : null}
                        {c.failed_count > 0 ? (
                          <span>{c.failed_count} failed</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-4 text-xs text-muted-foreground">
                      {agentName ?? c.agent_id ?? "—"}
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

      <CampaignCallLogSheet
        campaignId={logCampaignId}
        campaignName={logCampaign?.name ?? null}
        open={logOpen}
        onOpenChange={setLogOpen}
      />
    </>
  );
}
