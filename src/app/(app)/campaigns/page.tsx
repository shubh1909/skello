import { CalendarClockIcon, CheckCheckIcon, RadioIcon, ZapIcon } from "lucide-react";

import { ErrorCard } from "@/components/app/error-card";
import { CampaignHeaderActions } from "@/components/app/campaign-header-actions";
import { CampaignsFilterBar } from "@/components/app/campaigns-filter-bar";
import { CampaignsTable } from "@/components/app/campaigns-table";
import { NavTabs } from "@/components/app/nav-tabs";
import { StatCard } from "@/components/app/stat-card";
import { getCampaignStatusCounts, listCampaigns } from "@/actions/campaigns";
import { requireSession } from "@/lib/auth/session";
import type { CampaignStatus } from "@/types/campaign";

export const metadata = { title: "Campaigns · Skelo" };

const INITIAL_PAGE_SIZE = 50;

// The statuses worth a tab. `draft`, `paused`, `stopped` and `failed` exist but
// are rare and transient — they stay reachable under All rather than each
// getting a tab nobody clicks.
const FILTER_TABS: ReadonlyArray<{
  key: string;
  label: string;
  status?: CampaignStatus;
}> = [
  { key: "all", label: "All" },
  { key: "in_progress", label: "Running", status: "in_progress" },
  { key: "scheduled", label: "Scheduled", status: "scheduled" },
  { key: "completed", label: "Completed", status: "completed" },
];

interface PageProps {
  searchParams?: Promise<{ status?: string; q?: string }>;
}

export default async function CampaignsPage({ searchParams }: PageProps) {
  const session = await requireSession();
  const sp = (await searchParams) ?? {};
  const active =
    FILTER_TABS.find((t) => t.key === sp.status) ?? FILTER_TABS[0];
  const search = typeof sp.q === "string" ? sp.q.trim() : "";

  const [listResult, countsResult] = await Promise.all([
    listCampaigns({
      organisation_id: session.organisation.id,
      limit: INITIAL_PAGE_SIZE,
      offset: 0,
      status: active.status,
      q: search || undefined,
    }),
    // Counts span the whole org, deliberately independent of the active tab and
    // search — a tab that reported its own filtered count would always read the
    // same number as the table beneath it.
    getCampaignStatusCounts(session.organisation.id),
  ]);

  if (!listResult.success) {
    return <ErrorCard>{listResult.error}</ErrorCard>;
  }

  const rows = listResult.data.items;
  const total = listResult.data.total;
  const counts = countsResult.success ? countsResult.data : null;
  const allCount = counts
    ? Object.values(counts).reduce((sum, n) => sum + n, 0)
    : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            Campaigns
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Bulk outbound calling for {session.organisation.name}. Upload a
            CSV, choose retry rules, and Skelo dials each contact through the
            voice agent.
          </p>
        </div>
        <CampaignHeaderActions organisationId={session.organisation.id} />
      </header>

      {/* These used to be derived by filtering the first page of 50 rows, so on
          any org with more campaigns than that they were quietly wrong — and
          only "Completed" admitted it, with an "On this page" hint. They now
          come from a status count over the whole org. */}
      <section className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total campaigns"
          value={(allCount ?? total).toLocaleString()}
          icon={<RadioIcon />}
          hint="All time"
        />
        <StatCard
          label="Running"
          value={(counts?.in_progress ?? 0).toLocaleString()}
          icon={<ZapIcon />}
          hint="Currently dialing"
        />
        <StatCard
          label="Scheduled"
          value={(counts?.scheduled ?? 0).toLocaleString()}
          icon={<CalendarClockIcon />}
          hint="Waiting to start"
        />
        <StatCard
          label="Completed"
          value={(counts?.completed ?? 0).toLocaleString()}
          icon={<CheckCheckIcon />}
          hint="Finished runs"
        />
      </section>

      <div className="flex flex-col gap-4">
        {/* Tabs and search share one bottom rule. `md:items-end` keeps the nav
            flush with it, which is what the active tab's `-mb-px` underline
            sits on. */}
        <div className="flex flex-col gap-3 border-b border-border/60 md:flex-row md:items-end md:justify-between md:gap-4">
          <NavTabs
            aria-label="Campaign status"
            className="border-b-0"
            items={FILTER_TABS.map((tab) => ({
              // Search survives a tab switch — the two filters compose, and
              // clearing one by clicking the other would be a trap.
              href: `/campaigns?${new URLSearchParams({
                ...(tab.key === "all" ? {} : { status: tab.key }),
                ...(search ? { q: search } : {}),
              }).toString()}`,
              label: tab.label,
              active: tab.key === active.key,
              count:
                tab.key === "all"
                  ? (allCount ?? undefined)
                  : counts?.[tab.status!],
            }))}
          />
          <div className="pb-3 md:pb-2">
            <CampaignsFilterBar search={search} />
          </div>
        </div>

        <CampaignsTable
          // Remount on a filter change so infinite scroll starts from the fresh
          // first page instead of appending across filter sets.
          key={`${active.key}|${search}`}
          rows={rows}
          total={total}
          pageSize={INITIAL_PAGE_SIZE}
          organisationId={session.organisation.id}
          status={active.status}
          search={search || undefined}
        />
      </div>
    </div>
  );
}
