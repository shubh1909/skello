import Link from "next/link";
import {
  PhoneIncomingIcon,
  PhoneOutgoingIcon,
  UsersIcon,
} from "lucide-react";

import { ErrorCard } from "@/components/app/error-card";
import { NavTabs } from "@/components/app/nav-tabs";
import { LeadCreateDialog } from "@/components/app/lead-create-dialog";
import { LeadsActivityTable } from "@/components/app/leads-activity-table";
import { StatCard } from "@/components/app/stat-card";
import {
  getLeadCallLifetimeStats,
  getLeadStatusCounts,
  listLeadsWithCallActivity,
} from "@/actions/lead-activity";
import { LEAD_STATUS_LABEL, LEAD_STATUS_ORDER } from "@/lib/leads/status";
import type { LeadStatus } from "@/types/lead";
import { listLeadFieldDefinitions } from "@/actions/lead-field-definitions";
import { listLeadSheetBindings } from "@/actions/lead-sheet-bindings";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Leads · Skelo" };

const INITIAL_PAGE_SIZE = 50;

/**
 * The coloured dot beside each pipeline tab.
 *
 * Derived by hand rather than from LEAD_STATUS_VARIANT: that map names badge
 * VARIANTS (`success`, `warning`…), and a dot needs a background utility. Two
 * small maps beat a variant→class lookup table that exists for one caller.
 */
const STATUS_DOT: Record<LeadStatus, string> = {
  new: "bg-info",
  contacted: "bg-muted-foreground",
  qualified: "bg-success",
  negotiating: "bg-warning",
  won: "bg-success",
  lost: "bg-destructive",
};

/** Build a /leads URL, dropping params at their default rather than spelling
 *  out `?include=with-calls&status=` on every tab. */
function leadsHref(opts: {
  include: boolean;
  q?: string;
  status?: LeadStatus | null;
}): string {
  const params = new URLSearchParams();
  if (opts.include) params.set("include", "all");
  if (opts.q) params.set("q", opts.q);
  if (opts.status) params.set("status", opts.status);
  const qs = params.toString();
  return qs ? `/leads?${qs}` : "/leads";
}

/**
 * With-calls / all-leads, as a two-state switch in the toolbar.
 *
 * Still URL-backed links rather than client state — the server query needs the
 * value, and links keep cmd-click working — but rendered as a compact segmented
 * control so it stops competing with the pipeline tabs for attention.
 */
function ViewToggle({
  includeZero,
  q,
  status,
}: {
  includeZero: boolean;
  q: string;
  status: LeadStatus | null;
}) {
  const base =
    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap";
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border/70 bg-muted/40 p-0.5">
      <Link
        href={leadsHref({ include: false, q, status })}
        className={`${base} ${
          includeZero
            ? "text-muted-foreground hover:text-foreground"
            : "bg-card text-foreground shadow-xs"
        }`}
      >
        With calls
      </Link>
      <Link
        href={leadsHref({ include: true, q, status })}
        className={`${base} ${
          includeZero
            ? "bg-card text-foreground shadow-xs"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        All leads
      </Link>
    </div>
  );
}

interface PageProps {
  searchParams?: Promise<{ include?: string; q?: string; status?: string }>;
}

export default async function LeadsPage({ searchParams }: PageProps) {
  const session = await requireSession();
  const sp = (await searchParams) ?? {};
  const includeZero = sp.include === "all";
  const search = typeof sp.q === "string" ? sp.q.trim() : "";
  // The pipeline tab lives in the URL, not in client state: it is the thing a
  // manager sends to someone ("look at negotiating"), and a URL-backed tab
  // keeps cmd-click and the back button working. Anything unrecognised falls
  // back to "all" rather than filtering to nothing.
  const status = LEAD_STATUS_ORDER.find((s) => s === sp.status) ?? null;

  // Server-side status filter, merged with whatever the table adds client-side.
  const statusFilter = status
    ? [
        {
          source: "column" as const,
          category: "",
          key: "status",
          op: "eq" as const,
          value: status,
        },
      ]
    : [];

  const [activityRes, defsRes, statsRes, bindingsRes, statusRes] =
    await Promise.all([
    listLeadsWithCallActivity({
      org_slug: session.organisation.slug,
      include_zero_calls: includeZero,
      limit: INITIAL_PAGE_SIZE,
      offset: 0,
      filters: statusFilter,
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
    // Lifetime stat cards — counts run independently of the page's
    // include-zero-calls toggle, search, or filters so the headline
    // numbers stay stable as the operator narrows the table below.
    getLeadCallLifetimeStats({ org_slug: session.organisation.slug }),
    // Lead-sheet layout, fetched once here rather than on every sheet open.
    // A failure degrades to an unconfigured sheet (slots hide themselves), so
    // it must not gate the page the way the activity query does.
    listLeadSheetBindings(),
    // Funnel counts for the tab strip. Workspace-wide by design — the strip
    // hides them whenever a search or filter is active, because a tab reading
    // "812" above a table of three rows is a number that lies.
    getLeadStatusCounts({
      org_slug: session.organisation.slug,
      include_zero_calls: includeZero,
    }),
  ]);

  if (!activityRes.success) {
    return (
      <ErrorCard>
        {activityRes.error}
      </ErrorCard>
    );
  }

  const rows = activityRes.data.items;
  const total = activityRes.data.total;
  const catalog = defsRes.success ? defsRes.data : [];

  // `all` is summed here rather than asked for separately — the tab strip needs
  // it and the per-status rows already carry every lead exactly once.
  //
  // A FAILED counts query shows no numbers at all, never zeros. Zero is a
  // measurement; a missing RPC is not, and "Qualified 0" beside a tab that
  // opens onto 604 rows is worse than a tab with no number on it.
  const perStatus = statusRes.success ? statusRes.data : null;
  const statusCounts = perStatus
    ? {
        ...perStatus,
        all: Object.values(perStatus).reduce((a, b) => a + b, 0),
      }
    : null;
  const showCounts = statusCounts !== null && !search;

  const contactedCount = statsRes.success ? statsRes.data.contacted_leads : 0;
  const totalInbound = statsRes.success ? statsRes.data.inbound_calls : 0;
  const totalOutbound = statsRes.success ? statsRes.data.outbound_calls : 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            Leads
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            One row per unique phone, scoped to {session.organisation.name}.
            Counts pull from every call across the org — inbound and outbound.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LeadCreateDialog orgSlug={session.organisation.slug} />
        </div>
      </header>

      <section className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <StatCard
          label="Leads contacted"
          value={contactedCount.toLocaleString()}
          icon={<UsersIcon />}
          hint="Lifetime · with at least one call"
        />
        <StatCard
          label="Inbound calls"
          value={totalInbound.toLocaleString()}
          icon={<PhoneIncomingIcon />}
          hint="Lifetime · from the voice agent"
        />
        <StatCard
          label="Outbound calls"
          value={totalOutbound.toLocaleString()}
          icon={<PhoneOutgoingIcon />}
          hint="Lifetime · placed from Skelo"
        />
      </section>

      {/* The pipeline, as tabs. This replaces the old With-calls / All-leads
          pair, which spent the only tab row in the app on a toggle — that
          toggle now sits in the toolbar below, where a two-state switch
          belongs. Counts are suppressed while a search is active so the strip
          can't advertise a total the rows below contradict. */}
      <NavTabs
        aria-label="Pipeline status"
        items={[
          {
            href: leadsHref({ include: includeZero, q: search }),
            label: "All",
            active: !status,
            count: showCounts ? statusCounts.all : undefined,
          },
          ...LEAD_STATUS_ORDER.map((s) => ({
            href: leadsHref({ include: includeZero, q: search, status: s }),
            label: LEAD_STATUS_LABEL[s],
            active: status === s,
            icon: (
              <span
                aria-hidden
                className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[s]}`}
              />
            ),
            count: showCounts ? (statusCounts[s] ?? 0) : undefined,
          })),
        ]}
      />

      <LeadsActivityTable
        // Remounts when the server-side view changes: the table holds its own
        // paged list, and carrying page 3 of "qualified" into "won" would show
        // the wrong rows until the next fetch landed.
        key={`${includeZero ? "all" : "with-calls"}-${status ?? "any"}`}
        rows={rows}
        total={total}
        pageSize={INITIAL_PAGE_SIZE}
        organisationId={session.organisation.id}
        orgSlug={session.organisation.slug}
        includeZeroCalls={includeZero}
        statusFilter={status}
        catalog={catalog}
        bindings={bindingsRes.success ? bindingsRes.data : []}
        initialSearch={search}
        viewToggle={
          <ViewToggle includeZero={includeZero} q={search} status={status} />
        }
      />
    </div>
  );
}

