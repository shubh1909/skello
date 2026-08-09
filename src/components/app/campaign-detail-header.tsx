"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  DownloadIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PlayIcon,
  SquareIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  CampaignProgressBar,
  CampaignProgressLegend,
  campaignProgress,
} from "@/components/app/campaign-progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { runCampaignNow, stopCampaign } from "@/actions/campaigns";
import {
  CAMPAIGN_STATUS_LABEL,
  CAMPAIGN_STATUS_VARIANT,
} from "@/lib/campaigns/status";
import { useCampaignsRealtime } from "@/hooks/use-campaigns-realtime";
import type { Campaign } from "@/types/campaign";

/**
 * The campaign detail page's identity + controls + live progress.
 *
 * ## Why this is a client component
 *
 * The detail page is where you sit and *watch* a run, and it was the one screen
 * that never updated — a server-rendered snapshot with no realtime, while the
 * list page you'd just left refreshed itself. `useCampaignsRealtime` calls
 * `router.refresh()` on `campaigns` / `campaign_contacts` changes, so the
 * counts, the bar and the whole Performance tab below now follow the run.
 *
 * Run and Stop live here too. Previously the only control on this page was
 * Export, so stopping a campaign you were watching meant navigating back to the
 * list to find its row.
 */
export function CampaignDetailHeader({
  campaign,
  organisationId,
}: {
  campaign: Campaign;
  organisationId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  // `false` — this page always shows the one campaign, so there is no "user has
  // paged past the live window" case the list table has to suppress.
  useCampaignsRealtime(organisationId, false);

  const progress = campaignProgress(campaign);
  const canRun =
    campaign.status === "scheduled" ||
    campaign.status === "stopped" ||
    campaign.status === "paused" ||
    campaign.status === "completed";
  const canStop = campaign.status === "in_progress";
  const running = campaign.status === "in_progress";

  function act(kind: "run" | "stop") {
    startTransition(async () => {
      const res =
        kind === "run"
          ? await runCampaignNow({ id: campaign.id })
          : await stopCampaign({ id: campaign.id });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(kind === "run" ? "Campaign started" : "Campaign stopped");
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border bg-card p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight">
              {campaign.name}
            </h1>
            <Badge variant={CAMPAIGN_STATUS_VARIANT[campaign.status]}>
              {/* A live run gets a pulsing dot — the one place on the page that
                  says "this number is still moving". */}
              {running ? (
                <span className="mr-0.5 inline-block size-1.5 animate-pulse rounded-full bg-current" />
              ) : null}
              {CAMPAIGN_STATUS_LABEL[campaign.status]}
            </Badge>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {campaign.file_name ?? "Campaign"} ·{" "}
            {campaign.total_contacts.toLocaleString()} contacts
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {canStop ? (
            <Button
              variant="outline"
              onClick={() => act("stop")}
              disabled={pending}
            >
              {pending ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <SquareIcon />
              )}
              Stop
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => act("run")}
              disabled={pending || !canRun}
              title={canRun ? undefined : "Nothing to run"}
            >
              {pending ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
              Run now
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="More campaign actions"
                />
              }
            >
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                render={
                  <a href={`/api/campaigns/${campaign.id}/export`} download />
                }
              >
                <DownloadIcon /> Export calls (CSV)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* The list page showed a progress bar per row; the page you'd actually
          watch a run on showed none, and you had to scroll into Performance to
          find out how far along it was. */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-medium tabular-nums">
            {progress.donePct}% complete
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {progress.finished.toLocaleString()} of{" "}
            {progress.total.toLocaleString()} contacts resolved
            {progress.inFlight > 0
              ? ` · ${progress.inFlight.toLocaleString()} on the phone now`
              : ""}
          </span>
        </div>
        <CampaignProgressBar progress={progress} />
        <CampaignProgressLegend />
      </div>
    </section>
  );
}
