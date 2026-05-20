import Link from "next/link";
import {
  PhoneIncomingIcon,
  PhoneOutgoingIcon,
  UsersIcon,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { LeadCreateDialog } from "@/components/app/lead-create-dialog";
import { LeadExportDialog } from "@/components/app/lead-export-dialog";
import { LeadsActivityTable } from "@/components/app/leads-activity-table";
import { StatCard } from "@/components/app/stat-card";
import { listLeadsWithCallActivity } from "@/actions/lead-activity";
import { listLeadFieldDefinitions } from "@/actions/lead-field-definitions";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Leads · Skelo" };

const INITIAL_PAGE_SIZE = 50;

interface PageProps {
  searchParams?: Promise<{ include?: string; q?: string }>;
}

export default async function LeadsPage({ searchParams }: PageProps) {
  const session = await requireSession();
  const sp = (await searchParams) ?? {};
  const includeZero = sp.include === "all";
  const search = typeof sp.q === "string" ? sp.q.trim() : "";

  const [activityRes, defsRes] = await Promise.all([
    listLeadsWithCallActivity({
      org_slug: session.organisation.slug,
      include_zero_calls: includeZero,
      limit: INITIAL_PAGE_SIZE,
      offset: 0,
      search: search || undefined,
    }),
    // Fetch *all* catalog rows, not just visible. The table client needs
    // visibility for column rendering, filterability for the filter picker,
    // and sortability for the sort dropdown — three independent flags that
    // shouldn't gate each other.
    listLeadFieldDefinitions({
      organisation_id: session.organisation.id,
      visible_only: false,
    }),
  ]);

  if (!activityRes.success) {
    return (
      <Card className="border-destructive/40 p-6 text-sm text-destructive">
        {activityRes.error}
      </Card>
    );
  }

  const rows = activityRes.data.items;
  const total = activityRes.data.total;
  const catalog = defsRes.success ? defsRes.data : [];

  const contactedCount = rows.filter((r) => r.total_calls > 0).length;
  const totalInbound = rows.reduce((sum, r) => sum + r.inbound_calls, 0);
  const totalOutbound = rows.reduce((sum, r) => sum + r.outbound_calls, 0);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <h1 className="font-heading text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
            Leads
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            One row per unique phone, scoped to {session.organisation.name}.
            Counts pull from every call across the org — inbound and outbound.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LeadExportDialog />
          <LeadCreateDialog orgSlug={session.organisation.slug} />
        </div>
      </header>

      <section className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <StatCard
          label="Leads contacted"
          value={contactedCount.toLocaleString()}
          icon={<UsersIcon />}
          hint="With at least one call"
        />
        <StatCard
          label="Inbound calls"
          value={totalInbound.toLocaleString()}
          icon={<PhoneIncomingIcon />}
          hint="From the voice agent"
        />
        <StatCard
          label="Outbound calls"
          value={totalOutbound.toLocaleString()}
          icon={<PhoneOutgoingIcon />}
          hint="Placed from Skelo"
        />
      </section>

      <nav className="flex items-center gap-1 text-sm">
        <FilterTab href="/leads" active={!includeZero} label="With calls" />
        <FilterTab
          href="/leads?include=all"
          active={includeZero}
          label="All leads"
        />
      </nav>

      <LeadsActivityTable
        key={includeZero ? "all" : "with-calls"}
        rows={rows}
        total={total}
        pageSize={INITIAL_PAGE_SIZE}
        organisationId={session.organisation.id}
        orgSlug={session.organisation.slug}
        includeZeroCalls={includeZero}
        catalog={catalog}
        initialSearch={search}
      />
    </div>
  );
}

function FilterTab({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background"
          : "rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
      }
    >
      {label}
    </Link>
  );
}
