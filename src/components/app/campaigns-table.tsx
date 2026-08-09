"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  DownloadIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PlayIcon,
  RadioIcon,
  SearchXIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import {
  DataTableCard,
  DataTableHead,
  DataTableToolbar,
} from "@/components/app/data-table";
import {
  CampaignProgressBar,
  CampaignProgressLegend,
  campaignProgress,
} from "@/components/app/campaign-progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import {
  CAMPAIGN_STATUS_LABEL,
  CAMPAIGN_STATUS_VARIANT,
} from "@/lib/campaigns/status";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { formatOutcomeKey, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  Campaign,
  CampaignListItem,
  CampaignStatus,
} from "@/types/campaign";

// A campaign's stored status can lag behind reality: the DB only flips
// in_progress → completed via a trigger, and a lost result webhook can leave
// it "Running" after every contact has actually resolved. The dispatch tick
// reconciles this server-side, but the UI shouldn't show a stale "Running"
// in the meantime. If a campaign reads in_progress yet has nothing left to
// process (no in-flight calls and the finished count covers every contact),
// display it as "Wrapping up" so the operator knows it's effectively done.
function displayStatus(c: Campaign): { label: string; variant: BadgeVariant } {
  const finished = c.succeeded_count + c.failed_count;
  const allResolved =
    c.in_flight_count === 0 &&
    c.total_contacts > 0 &&
    finished >= c.total_contacts;
  if (c.status === "in_progress" && allResolved) {
    return { label: "Wrapping up", variant: CAMPAIGN_STATUS_VARIANT.completed };
  }
  return {
    label: CAMPAIGN_STATUS_LABEL[c.status],
    variant: CAMPAIGN_STATUS_VARIANT[c.status],
  };
}

interface CampaignsTableProps {
  rows: CampaignListItem[];
  total: number;
  pageSize: number;
  organisationId: string;
  /** The active filters, so page 2 is filtered the same way page 1 was. */
  status?: CampaignStatus;
  search?: string;
}

export function CampaignsTable({
  rows,
  total,
  pageSize,
  organisationId,
  status,
  search,
}: CampaignsTableProps) {
  const router = useRouter();
  const now = useClientNow();

  const fetchPage = React.useCallback(
    async (offset: number, limit: number) => {
      const res = await listCampaigns({
        organisation_id: organisationId,
        limit,
        offset,
        // Without these, scrolling a filtered list appends UNFILTERED rows —
        // page 1 says "Running" and page 2 quietly includes everything.
        status,
        q: search,
      });
      if (!res.success) {
        toast.error(res.error);
        return null;
      }
      return res.data;
    },
    [organisationId, status, search],
  );

  const {
    items,
    total: liveTotal,
    loading,
    hasMore,
    pagedBeyondInitial,
    sentinelRef,
  } = useInfiniteList<CampaignListItem>({
    initialItems: rows,
    initialTotal: total,
    pageSize,
    fetchPage,
  });

  useCampaignsRealtime(organisationId, pagedBeyondInitial);

  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  // Whatever is awaiting confirmation. Stop used to call `window.confirm()` —
  // a native OS dialog in an app that has its own, unstyleable and impossible
  // to explain the consequence in.
  const [confirmAction, setConfirmAction] = React.useState<{
    kind: "delete" | "stop";
    campaign: Campaign;
  } | null>(null);
  const confirming =
    pending && confirmAction !== null && pendingId === confirmAction.campaign.id;

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
    setConfirmAction({ kind: "stop", campaign: c });
  }

  function onDelete(c: Campaign) {
    setConfirmAction({ kind: "delete", campaign: c });
  }

  function runConfirmed() {
    if (!confirmAction) return;
    const { kind, campaign } = confirmAction;
    setPendingId(campaign.id);
    startTransition(async () => {
      const res =
        kind === "delete"
          ? await deleteCampaign({ id: campaign.id })
          : await stopCampaign({ id: campaign.id });
      setPendingId(null);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(
        kind === "delete" ? "Campaign data deleted" : "Campaign stopped",
      );
      setConfirmAction(null);
      router.refresh();
    });
  }

  function onDownload(c: Campaign) {
    const a = document.createElement("a");
    a.href = `/api/campaigns/${c.id}/export`;
    a.click();
  }

  if (items.length === 0) {
    // A filter that matches nothing is not an empty workspace, and telling
    // someone with 200 campaigns to "upload a CSV" reads as though their data
    // is gone.
    const filtered = Boolean(status || search);
    return (
      <Empty className="border py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="size-12 rounded-full">
            {filtered ? (
              <SearchXIcon className="size-5" />
            ) : (
              <RadioIcon className="size-5" />
            )}
          </EmptyMedia>
          <EmptyTitle>
            {filtered ? "No campaigns match" : "No campaigns yet"}
          </EmptyTitle>
          <EmptyDescription>
            {filtered
              ? "Nothing here with that status or search term. Clear the filters to see every campaign."
              : "Upload a CSV of phone numbers to start a bulk outbound run. Skelo will dial each one and retry failures based on your rules."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      <DataTableCard>
        {/* One legend for the whole table. It used to be repeated inside every
            progress cell — the same four words fifty times. */}
        <DataTableToolbar className="justify-between">
          <span className="text-xs text-muted-foreground tabular-nums">
            {liveTotal.toLocaleString()}{" "}
            {liveTotal === 1 ? "campaign" : "campaigns"}
          </span>
          <CampaignProgressLegend />
        </DataTableToolbar>
        <div className="no-scrollbar overflow-x-auto">
          <table className="w-full min-w-180 text-left text-sm">
            <DataTableHead>
              <th scope="col" className="px-5 py-3 font-medium">
                Campaign
              </th>
              <th scope="col" className="px-3 py-3 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Progress
              </th>
              <th scope="col" className="px-3 py-3 font-medium">
                Created
              </th>
              <th scope="col" className="px-5 py-3 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </DataTableHead>
            <tbody className="divide-y divide-border/60">
              {items.map((c) => {
                const isBusy = pending && pendingId === c.id;
                const canRun =
                  c.status === "scheduled" ||
                  c.status === "stopped" ||
                  c.status === "paused" ||
                  c.status === "completed";
                const canStop = c.status === "in_progress";
                const p = campaignProgress(c);
                const s = displayStatus(c);

                return (
                  <tr
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open campaign ${c.name}`}
                    onClick={() => router.push(`/campaigns/${c.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(`/campaigns/${c.id}`);
                      }
                    }}
                    className="group cursor-pointer transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                  >
                    {/* Name leads. The old layout put an 8-character UUID slice
                        on the first line and the name underneath, so the one
                        thing an operator recognises was the secondary text. The
                        id is still here for support requests, just quieter. */}
                    <td className="px-5 py-3.5">
                      <p className="line-clamp-1 font-medium">{c.name}</p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        {c.file_name ? (
                          <span className="line-clamp-1 max-w-45">
                            {c.file_name}
                          </span>
                        ) : null}
                        <span className="tabular-nums">
                          {c.valid_contacts.toLocaleString()} /{" "}
                          {c.total_contacts.toLocaleString()} contacts
                        </span>
                      </p>
                    </td>

                    <td className="px-3 py-3.5">
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant={s.variant}>{s.label}</Badge>
                        {c.best_disposition ? (
                          <span className="text-[11px] text-muted-foreground">
                            {formatOutcomeKey(c.best_disposition)}
                          </span>
                        ) : null}
                      </div>
                    </td>

                    <td className="min-w-52 px-4 py-3.5">
                      <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
                        <span className="font-medium">{p.donePct}%</span>
                        <span className="text-muted-foreground">
                          {p.finished.toLocaleString()} /{" "}
                          {p.total.toLocaleString()}
                        </span>
                      </div>
                      <CampaignProgressBar progress={p} className="mt-1.5" />
                    </td>

                    <td
                      className="px-3 py-3.5 text-xs text-muted-foreground"
                      suppressHydrationWarning
                    >
                      {now === null ? "—" : formatRelative(c.created_at, now)}
                    </td>

                    <td className="px-5 py-3.5">
                      {/* Stop row-navigation when an action is used. */}
                      <div
                        className="flex items-center justify-end gap-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Run and Stop stay on the row: they are the two
                            things an operator does from this screen, and
                            burying them costs a click on every use. */}
                        <Tooltip>
                          <TooltipTrigger
                            delay={150}
                            render={
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => onRunNow(c)}
                                disabled={isBusy || !canRun}
                                aria-label={`Run ${c.name} now`}
                              />
                            }
                          >
                            {isBusy ? (
                              <Loader2Icon className="animate-spin" />
                            ) : (
                              <PlayIcon />
                            )}
                          </TooltipTrigger>
                          <TooltipContent>
                            {canRun ? "Run now" : "Already running"}
                          </TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger
                            delay={150}
                            render={
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => onStop(c)}
                                disabled={isBusy || !canStop}
                                aria-label={`Stop ${c.name}`}
                              />
                            }
                          >
                            <SquareIcon />
                          </TooltipTrigger>
                          <TooltipContent>
                            {canStop ? "Stop" : "Not running"}
                          </TooltipContent>
                        </Tooltip>

                        {/* Delete used to sit inline, one pixel from Download.
                            Destructive actions live behind the overflow menu
                            everywhere else in the app. */}
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`More actions for ${c.name}`}
                              />
                            }
                          >
                            <MoreHorizontalIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onDownload(c)}>
                              <DownloadIcon /> Download results CSV
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => onDelete(c)}
                              disabled={isBusy}
                            >
                              <Trash2Icon /> Delete all data
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </DataTableCard>

      <InfiniteScrollFooter
        loading={loading}
        hasMore={hasMore}
        loadedCount={items.length}
        total={liveTotal}
        sentinelRef={sentinelRef}
      />

      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          // Don't let an outside-click / Escape dismiss mid-action.
          if (!open && !confirming) setConfirmAction(null);
        }}
      >
        <DialogContent showCloseButton={!confirming}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span
                className={cn(
                  "grid size-8 place-items-center rounded-full",
                  confirmAction?.kind === "delete"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-warning-muted text-warning",
                )}
              >
                {confirmAction?.kind === "delete" ? (
                  <AlertTriangleIcon className="size-4" />
                ) : (
                  <SquareIcon className="size-4" />
                )}
              </span>
              {confirmAction?.kind === "delete"
                ? "Delete all campaign data?"
                : "Stop this campaign?"}
            </DialogTitle>
            <DialogDescription>
              {confirmAction?.kind === "delete" ? (
                <>
                  This removes{" "}
                  <span className="font-medium text-foreground">
                    {confirmAction.campaign.name}
                  </span>{" "}
                  — its contacts, every call and transcript, and the leads it
                  created — from your workspace. Leads shared with other calls
                  are kept.
                </>
              ) : (
                <>
                  Dials already in flight will finish;{" "}
                  <span className="font-medium text-foreground">
                    every contact still queued is skipped.
                  </span>{" "}
                  You can start the campaign again later, and it will pick up
                  the contacts it never reached.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {confirmAction?.kind === "delete" ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              This{" "}
              <span className="font-medium text-foreground">
                cannot be undone
              </span>{" "}
              from your side. Download a copy first if you need the data.
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => onDownload(confirmAction.campaign)}
                disabled={confirming}
                className="mt-2 flex"
              >
                <DownloadIcon /> Download results CSV
              </Button>
            </div>
          ) : null}

          <DialogFooter>
            <DialogClose
              render={
                <Button variant="outline" type="button" disabled={confirming} />
              }
            >
              Cancel
            </DialogClose>
            <Button
              type="button"
              variant={
                confirmAction?.kind === "delete" ? "destructive" : "default"
              }
              onClick={runConfirmed}
              disabled={confirming}
            >
              {confirming ? (
                <Loader2Icon className="animate-spin" />
              ) : confirmAction?.kind === "delete" ? (
                <Trash2Icon />
              ) : (
                <SquareIcon />
              )}
              {confirming
                ? "Working…"
                : confirmAction?.kind === "delete"
                  ? "Delete data"
                  : "Stop campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
