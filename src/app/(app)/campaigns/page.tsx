import {
  CalendarClockIcon,
  CheckCheckIcon,
  RadioIcon,
  ZapIcon,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { CampaignUploadDialog } from "@/components/app/campaign-upload-dialog";
import { CampaignsTable } from "@/components/app/campaigns-table";
import { Pagination } from "@/components/app/pagination";
import { StatCard } from "@/components/app/stat-card";
import { listCampaigns } from "@/actions/campaigns";
import { requireSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Campaigns · Skelo" };

const PAGE_SIZE = 20;

interface PageProps {
  searchParams?: Promise<{ page?: string }>;
}

export default async function CampaignsPage({ searchParams }: PageProps) {
  const session = await requireSession();
  const sp = (await searchParams) ?? {};
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [listResult, agentResult] = await Promise.all([
    listCampaigns({
      organisation_id: session.organisation.id,
      limit: PAGE_SIZE,
      offset,
    }),
    (async () => {
      const admin = createAdminClient();
      const { data } = await admin
        .from("bolna_integrations")
        .select("agent_id")
        .eq("organisation_id", session.organisation.id)
        .maybeSingle<{ agent_id: string }>();
      return data?.agent_id ?? null;
    })(),
  ]);

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
        <div className="flex items-center gap-2">
          <CampaignUploadDialog organisationId={session.organisation.id} />
        </div>
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
        organisationId={session.organisation.id}
        agentName={agentResult}
      />

      <Pagination
        total={total}
        pageSize={PAGE_SIZE}
        currentPage={page}
        baseHref="/campaigns"
      />
    </div>
  );
}
