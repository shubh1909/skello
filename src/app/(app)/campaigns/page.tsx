import { CalendarClockIcon, CheckCheckIcon, RadioIcon, ZapIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { CampaignHeaderActions } from "@/components/app/campaign-header-actions";
import { CampaignsTable } from "@/components/app/campaigns-table";
import { StatCard } from "@/components/app/stat-card";
import { listCampaigns } from "@/actions/campaigns";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Campaigns · Skelo" };

const INITIAL_PAGE_SIZE = 50;

export default async function CampaignsPage() {
  const session = await requireSession();

  const listResult = await listCampaigns({
    organisation_id: session.organisation.id,
    limit: INITIAL_PAGE_SIZE,
    offset: 0,
  });

  if (!listResult.success) {
    return (
      <Card className="border-destructive/40 p-6 text-sm text-destructive">
        {listResult.error}
      </Card>
    );
  }

  const rows = listResult.data.items;
  const total = listResult.data.total;
  const activeCount = rows.filter((r) => r.status === "in_progress").length;
  const scheduledCount = rows.filter((r) => r.status === "scheduled").length;
  const completedCount = rows.filter((r) => r.status === "completed").length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <h1 className="font-heading text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
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

      <section className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total campaigns"
          value={total.toLocaleString()}
          icon={<RadioIcon />}
          hint="All time"
        />
        <StatCard
          label="Running"
          value={activeCount.toLocaleString()}
          icon={<ZapIcon />}
          hint="Currently dialing"
        />
        <StatCard
          label="Scheduled"
          value={scheduledCount.toLocaleString()}
          icon={<CalendarClockIcon />}
          hint="Waiting to start"
        />
        <StatCard
          label="Completed"
          value={completedCount.toLocaleString()}
          icon={<CheckCheckIcon />}
          hint="On this page"
        />
      </section>

      <CampaignsTable
        rows={rows}
        total={total}
        pageSize={INITIAL_PAGE_SIZE}
        organisationId={session.organisation.id}
      />
    </div>
  );
}
