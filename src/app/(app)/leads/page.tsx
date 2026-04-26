import {
  BellRingIcon,
  FlameIcon,
  MessageCircleIcon,
  UsersIcon,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { LeadCreateDialog } from "@/components/app/lead-create-dialog";
import { LeadExportDialog } from "@/components/app/lead-export-dialog";
import {
  LeadsFilterBar,
  type LeadFilters,
} from "@/components/app/leads-filter-bar";
import { LeadsTable } from "@/components/app/leads-table";
import { StatCard } from "@/components/app/stat-card";
import { listLeads } from "@/actions/leads";
import { listReminders } from "@/actions/reminders";
import { requireSession } from "@/lib/auth/session";
import { renderNow } from "@/lib/format";
import type { Lead, LeadIntent, LeadSource, LeadStatus } from "@/types/lead";

export const metadata = { title: "Leads · Skello" };

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const INTENTS: readonly LeadIntent[] = ["hot", "warm", "cold"];
const STATUSES: readonly LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "negotiating",
  "won",
  "lost",
];
const SOURCES: readonly LeadSource[] = [
  "inbound_call",
  "whatsapp",
  "manual",
  "import",
  "web_form",
];

function readFilters(
  sp: Record<string, string | string[] | undefined>,
): LeadFilters {
  const one = (key: string): string | undefined => {
    const v = sp[key];
    return Array.isArray(v) ? v[0] : v;
  };
  const intent = one("intent")?.toLowerCase();
  const contacted = one("contacted");
  const wants = one("wants");
  const status = one("status")?.toLowerCase();
  const source = one("source")?.toLowerCase();

  return {
    q: one("q")?.trim() || undefined,
    intent:
      intent && (INTENTS as readonly string[]).includes(intent)
        ? (intent as LeadIntent)
        : undefined,
    contacted:
      contacted === "yes" || contacted === "no" ? contacted : undefined,
    wants: wants === "yes" || wants === "no" ? wants : undefined,
    status:
      status && (STATUSES as readonly string[]).includes(status)
        ? (status as LeadStatus)
        : undefined,
    source:
      source && (SOURCES as readonly string[]).includes(source)
        ? (source as LeadSource)
        : undefined,
  };
}

export default async function LeadsPage({ searchParams }: PageProps) {
  const session = await requireSession();
  const orgId = session.organisation.id;
  const orgSlug = session.organisation.slug;
  const sp = (await searchParams) ?? {};
  const filters = readFilters(sp);

  const [result, remindersResult] = await Promise.all([
    listLeads({
      org_slug: orgSlug,
      limit: 100,
      offset: 0,
      q: filters.q,
      lead_intent: filters.intent,
      contacted_on_watsapp:
        filters.contacted === "yes"
          ? true
          : filters.contacted === "no"
            ? false
            : undefined,
      wants_to_connect_on_watsapp:
        filters.wants === "yes"
          ? true
          : filters.wants === "no"
            ? false
            : undefined,
      status: filters.status,
      source: filters.source,
    }),
    listReminders({
      organisation_id: orgId,
      status: "pending",
      limit: 100,
      offset: 0,
    }),
  ]);

  const leads = result.success ? result.data.items : [];
  const total = result.success ? result.data.total : 0;
  const reminders = remindersResult.success ? remindersResult.data.items : [];

  const now = renderNow();
  const day = 24 * 60 * 60 * 1000;
  const t24 = now - day;
  const t48 = now - 2 * day;

  const hot = leads.filter((l) => l.lead_intent === "hot").length;
  const contacted = leads.filter((l) => l.contacted_on_watsapp).length;
  const dueToday = reminders.filter(
    (r) => new Date(r.remind_at).getTime() <= now + day,
  ).length;

  // Day-over-day deltas — computed from the loaded page of 100 recent items.
  // Accurate as long as creates/updates in the 48h window stay within that page.
  const createdBetween = (l: Lead, from: number, to: number) => {
    const t = new Date(l.created_at).getTime();
    return t >= from && t < to;
  };
  const updatedBetween = (l: Lead, from: number, to: number) => {
    const t = new Date(l.updated_at).getTime();
    return t >= from && t < to;
  };

  const totalTodayDelta = leads.filter((l) =>
    createdBetween(l, t24, now),
  ).length;
  const hotDelta =
    leads.filter((l) => l.lead_intent === "hot" && createdBetween(l, t24, now))
      .length -
    leads.filter((l) => l.lead_intent === "hot" && createdBetween(l, t48, t24))
      .length;
  const contactedDelta =
    leads.filter(
      (l) => l.contacted_on_watsapp && updatedBetween(l, t24, now),
    ).length -
    leads.filter(
      (l) => l.contacted_on_watsapp && updatedBetween(l, t48, t24),
    ).length;
  const reminderDelta =
    reminders.filter((r) => {
      const t = new Date(r.created_at).getTime();
      return t >= t24 && t < now;
    }).length -
    reminders.filter((r) => {
      const t = new Date(r.created_at).getTime();
      return t >= t48 && t < t24;
    }).length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1.5">
          <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            Leads
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {total} total · scoped to {session.organisation.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LeadExportDialog />
          <LeadCreateDialog orgSlug={orgSlug} />
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total leads"
          value={total.toLocaleString()}
          icon={<UsersIcon />}
          trend={{ delta: totalTodayDelta }}
        />
        <StatCard
          label="Hot leads"
          value={hot}
          icon={<FlameIcon />}
          trend={{ delta: hotDelta }}
        />
        <StatCard
          label="WhatsApp contacted"
          value={contacted}
          icon={<MessageCircleIcon />}
          trend={{ delta: contactedDelta }}
        />
        <StatCard
          label="Reminders due ≤24h"
          value={dueToday}
          icon={<BellRingIcon />}
          trend={{ delta: reminderDelta }}
        />
      </section>

      <LeadsFilterBar filters={filters} total={total} />

      {!result.success ? (
        <Card className="border-destructive/40 p-6 text-sm text-destructive">
          {result.error}
        </Card>
      ) : (
        <LeadsTable leads={leads} organisationId={orgId} />
      )}
    </div>
  );
}
