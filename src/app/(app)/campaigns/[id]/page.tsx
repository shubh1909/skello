import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, BarChart3Icon, ListIcon } from "lucide-react";

import { ErrorCard } from "@/components/app/error-card";
import { NavTabs } from "@/components/app/nav-tabs";
import { Button } from "@/components/ui/button";
import { CampaignCallsFilterBar } from "@/components/app/campaign-calls-filter-bar";
import { CampaignDetailHeader } from "@/components/app/campaign-detail-header";
import { CampaignPerformance } from "@/components/app/campaign-performance";
import { ConversationsTable } from "@/components/app/conversations-table";
import {
  getCampaign,
  getCampaignStats,
  listCampaignOutcomeOptions,
} from "@/actions/campaigns";
import { listConversations } from "@/actions/calls";
import { requireSession } from "@/lib/auth/session";
import type { CallStatus } from "@/types/call";

export const metadata = { title: "Campaign · Skelo" };

const INITIAL_PAGE_SIZE = 50;

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
      <ErrorCard>
        {campaignResult.error}
      </ErrorCard>
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

      {/* Client component: it subscribes to campaign realtime, so this page
          follows a running campaign instead of being a snapshot you refresh. */}
      <CampaignDetailHeader
        campaign={campaign}
        organisationId={session.organisation.id}
      />

      <NavTabs
        aria-label="Campaign view"
        items={[
          {
            href: `/campaigns/${campaign.id}?tab=performance`,
            label: "Performance",
            active: tab === "performance",
            icon: <BarChart3Icon />,
          },
          {
            href: `/campaigns/${campaign.id}?tab=calls`,
            label: "Calls",
            active: tab === "calls",
            icon: <ListIcon />,
          },
        ]}
      />

      {tab === "performance" ? (
        !statsResult || !statsResult.success ? (
          <ErrorCard>
            {statsResult?.error ?? "Could not load performance data."}
          </ErrorCard>
        ) : (
          <CampaignPerformance stats={statsResult.data} />
        )
      ) : !callsResult || !callsResult.success ? (
        <ErrorCard>
          {callsResult?.error ?? "Could not load calls."}
        </ErrorCard>
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

