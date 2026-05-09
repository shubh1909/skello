import Link from "next/link";
import {
  HeadphonesIcon,
  PhoneIncomingIcon,
  PhoneOutgoingIcon,
  UsersIcon,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { LeadCreateDialog } from "@/components/app/lead-create-dialog";
import { LeadExportDialog } from "@/components/app/lead-export-dialog";
import { LeadsActivityTable } from "@/components/app/leads-activity-table";
import { Pagination } from "@/components/app/pagination";
import { StatCard } from "@/components/app/stat-card";
import { listLeadsWithCallActivity } from "@/actions/lead-activity";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Leads · Skelo" };

const PAGE_SIZE = 10;

interface PageProps {
  searchParams?: Promise<{ include?: string; page?: string }>;
}

export default async function LeadsPage({ searchParams }: PageProps) {
  const session = await requireSession();
  const sp = (await searchParams) ?? {};
  const includeZero = sp.include === "all";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const result = await listLeadsWithCallActivity({
    org_slug: session.organisation.slug,
    include_zero_calls: includeZero,
    limit: PAGE_SIZE,
    offset,
  });

  if (!result.success) {
    return (
      <Card className="border-destructive/40 p-6 text-sm text-destructive">
        {result.error}
      </Card>
    );
  }

  const rows = result.data.items;
  const total = result.data.total;
  const contactedCount = rows.filter((r) => r.total_calls > 0).length;
  const totalInbound = rows.reduce((sum, r) => sum + r.inbound_calls, 0);
  const totalOutbound = rows.reduce((sum, r) => sum + r.outbound_calls, 0);
  const totalCalls = totalInbound + totalOutbound;
  const avgPerLead =
    contactedCount === 0 ? 0 : totalCalls / contactedCount;

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

      <section className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
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
        <StatCard
          label="Avg calls per lead"
          value={avgPerLead.toFixed(1)}
          icon={<HeadphonesIcon />}
          hint={`${totalCalls.toLocaleString()} total touchpoints`}
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
        rows={rows}
        organisationId={session.organisation.id}
        orgSlug={session.organisation.slug}
      />

      <Pagination
        total={total}
        pageSize={PAGE_SIZE}
        currentPage={page}
        baseHref="/leads"
        preserveParams={{ include: includeZero ? "all" : undefined }}
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
