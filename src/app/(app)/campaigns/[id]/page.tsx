import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeftIcon,
  BarChart3Icon,
  DownloadIcon,
  ListIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CampaignCallsFilterBar } from "@/components/app/campaign-calls-filter-bar";
import { CampaignPerformance } from "@/components/app/campaign-performance";
import { ConversationsTable } from "@/components/app/conversations-table";
import {
  getCampaign,
  getCampaignStats,
  listCampaignOutcomeOptions,
} from "@/actions/campaigns";
import { listConversations } from "@/actions/calls";
import { requireSession } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import type { CallStatus } from "@/types/call";
import type { CampaignStatus } from "@/types/campaign";

export const metadata = { title: "Campaign · Skelo" };

const INITIAL_PAGE_SIZE = 50;

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
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  in_progress:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  paused: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  stopped: "bg-muted text-foreground",
  completed: "bg-muted text-foreground",
  failed: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};

type Tab = "performance" | "calls";

const CALL_STATUSES: readonly CallStatus[] = [
  "initiated",
  "ringing",
  "in_progress",
  "completed",
  "failed",
  "no_answer",
  "busy",
  "canceled",
];

// Pull the Calls-tab filter set off the query string (validated).
function readCallFilters(sp: Record<string, string | string[] | undefined>): {
  status?: CallStatus;
  outcome?: string;
  q?: string;
} {
  const one = (key: string): string | undefined => {
    const v = sp[key];
    return Array.isArray(v) ? v[0] : v;
  };
  const statusRaw = one("status")?.toLowerCase();
  return {
    status:
      statusRaw && (CALL_STATUSES as readonly string[]).includes(statusRaw)
        ? (statusRaw as CallStatus)
        : undefined,
    outcome: one("outcome")?.trim() || undefined,
    q: one("q")?.trim() || undefined,
  };
}

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CampaignDetailPage({
  params,
  searchParams,
}: PageProps) {
  const session = await requireSession();
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const rawTab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: Tab = rawTab === "calls" ? "calls" : "performance";
  const callFilters = readCallFilters(sp);

  const campaignResult = await getCampaign({ id });
  if (!campaignResult.success) {
    if (campaignResult.error === "Campaign not found") notFound();
    return (
      <Card className="border-destructive/40 p-6 text-sm text-destructive">
        {campaignResult.error}
      </Card>
    );
  }
  const campaign = campaignResult.data;

  // Fetch only what the active tab needs to keep the page snappy.
  const [statsResult, callsResult, outcomeOptionsResult] = await Promise.all([
    tab === "performance" ? getCampaignStats({ id }) : Promise.resolve(null),
    tab === "calls"
      ? listConversations({
          organisation_id: session.organisation.id,
          limit: INITIAL_PAGE_SIZE,
          offset: 0,
          campaign_id: id,
          status: callFilters.status,
          call_outcome: callFilters.outcome,
          q: callFilters.q,
        })
      : Promise.resolve(null),
    tab === "calls"
      ? listCampaignOutcomeOptions(session.organisation.id)
      : Promise.resolve(null),
  ]);
  const outcomeOptions =
    outcomeOptionsResult && outcomeOptionsResult.success
      ? outcomeOptionsResult.data
      : [];
  // Remount the table when filters change so infinite-scroll resets to the
  // fresh first page instead of appending across filter sets.
  const callsTableKey = `${callFilters.status ?? ""}|${callFilters.outcome ?? ""}|${callFilters.q ?? ""}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          render={<Link href="/campaigns" />}
        >
          <ArrowLeftIcon /> Back to campaigns
        </Button>
      </div>

      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
              {campaign.name}
            </h1>
            <Badge className={STATUS_CLASS[campaign.status]}>
              {STATUS_LABEL[campaign.status]}
            </Badge>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {campaign.file_name ?? "Campaign"} ·{" "}
            {campaign.total_contacts.toLocaleString()} contacts
          </p>
        </div>
        <Button
          variant="outline"
          render={
            <a href={`/api/campaigns/${campaign.id}/export`} download />
          }
        >
          <DownloadIcon /> Export calls (CSV)
        </Button>
      </header>

      {/* Tabs */}
      <nav className="flex items-center gap-1 border-b border-border/60">
        <TabLink
          href={`/campaigns/${campaign.id}?tab=performance`}
          active={tab === "performance"}
          icon={<BarChart3Icon className="size-4" />}
          label="Performance"
        />
        <TabLink
          href={`/campaigns/${campaign.id}?tab=calls`}
          active={tab === "calls"}
          icon={<ListIcon className="size-4" />}
          label="Calls"
        />
      </nav>

      {tab === "performance" ? (
        !statsResult || !statsResult.success ? (
          <Card className="border-destructive/40 p-6 text-sm text-destructive">
            {statsResult?.error ?? "Could not load performance data."}
          </Card>
        ) : (
          <CampaignPerformance stats={statsResult.data} />
        )
      ) : !callsResult || !callsResult.success ? (
        <Card className="border-destructive/40 p-6 text-sm text-destructive">
          {callsResult?.error ?? "Could not load calls."}
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <CampaignCallsFilterBar
            filters={callFilters}
            outcomeOptions={outcomeOptions}
          />
          <ConversationsTable
            key={callsTableKey}
            calls={callsResult.data.items}
            total={callsResult.data.total}
            pageSize={INITIAL_PAGE_SIZE}
            organisationId={session.organisation.id}
            filters={{
              campaignId: campaign.id,
              status: callFilters.status,
              callOutcome: callFilters.outcome,
              q: callFilters.q,
            }}
          />
        </div>
      )}
    </div>
  );
}

function TabLink({
  href,
  active,
  icon,
  label,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </Link>
  );
}
