import {
  CalendarClockIcon,
  CheckCheckIcon,
  RadioIcon,
  ZapIcon,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { CampaignUploadDialog } from "@/components/app/campaign-upload-dialog";
import { CampaignsTable } from "@/components/app/campaigns-table";
import { StatCard } from "@/components/app/stat-card";
import { TestCallDialog } from "@/components/app/test-call-dialog";
import { VoiceConfigDialog } from "@/components/app/voice-config-dialog";
import { listCampaigns } from "@/actions/campaigns";
import { requireSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Campaigns · Skelo" };

const INITIAL_PAGE_SIZE = 50;

export default async function CampaignsPage() {
  const session = await requireSession();

  const [listResult, voiceLabels] = await Promise.all([
    listCampaigns({
      organisation_id: session.organisation.id,
      limit: INITIAL_PAGE_SIZE,
      offset: 0,
    }),
    (async () => {
      // Build lookup tables so the table can render labels next to each
      // campaign's chosen agent / dialling number without N+1 queries.
      const admin = createAdminClient();
      const { data } = await admin
        .from("bolna_integrations")
        .select(
          "agent_id, agent_labels, from_phone_number, from_phone_labels",
        )
        .eq("organisation_id", session.organisation.id)
        .maybeSingle<{
          agent_id: string;
          agent_labels: Record<string, unknown>;
          from_phone_number: string | null;
          from_phone_labels: Record<string, unknown>;
        }>();
      const agentLabels: Record<string, string> = {};
      const numberLabels: Record<string, string> = {};
      if (data) {
        for (const [k, v] of Object.entries(data.agent_labels ?? {})) {
          if (typeof v === "string" && v.length > 0) agentLabels[k] = v;
        }
        for (const [k, v] of Object.entries(data.from_phone_labels ?? {})) {
          if (typeof v === "string" && v.length > 0) numberLabels[k] = v;
        }
        if (data.agent_id && !agentLabels[data.agent_id]) {
          agentLabels[data.agent_id] = "Default agent";
        }
      }
      return {
        defaultAgentId: data?.agent_id ?? null,
        defaultFromPhone: data?.from_phone_number ?? null,
        agentLabels,
        numberLabels,
      };
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
          <TestCallDialog organisationId={session.organisation.id} />
          <VoiceConfigDialog organisationId={session.organisation.id} />
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
        total={total}
        pageSize={INITIAL_PAGE_SIZE}
        organisationId={session.organisation.id}
        defaultAgentId={voiceLabels.defaultAgentId}
        defaultFromPhone={voiceLabels.defaultFromPhone}
        agentLabels={voiceLabels.agentLabels}
        numberLabels={voiceLabels.numberLabels}
      />
    </div>
  );
}
