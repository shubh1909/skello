import { Card } from "@/components/ui/card";
import { LeadCreateDialog } from "@/components/app/lead-create-dialog";
import {
  LeadsFilterBar,
  type LeadFilters,
} from "@/components/app/leads-filter-bar";
import { LeadsTable } from "@/components/app/leads-table";
import { listLeads } from "@/actions/leads";
import { requireSession } from "@/lib/auth/session";
import type { LeadIntent } from "@/types/lead";

export const metadata = { title: "Leads · Skello" };

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const INTENTS: readonly LeadIntent[] = ["hot", "warm", "cold"];

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
  const hasPhone = one("hasPhone");

  return {
    q: one("q")?.trim() || undefined,
    intent:
      intent && (INTENTS as readonly string[]).includes(intent)
        ? (intent as LeadIntent)
        : undefined,
    contacted:
      contacted === "yes" || contacted === "no" ? contacted : undefined,
    wants: wants === "yes" || wants === "no" ? wants : undefined,
    hasPhone: hasPhone === "yes" || hasPhone === "no" ? hasPhone : undefined,
  };
}

export default async function LeadsPage({ searchParams }: PageProps) {
  const session = await requireSession();
  const sp = (await searchParams) ?? {};
  const filters = readFilters(sp);

  const result = await listLeads({
    org_slug: session.organisation.slug,
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
    has_phone:
      filters.hasPhone === "yes"
        ? true
        : filters.hasPhone === "no"
          ? false
          : undefined,
  });

  const leads = result.success ? result.data.items : [];
  const total = result.success ? result.data.total : 0;

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
          <LeadCreateDialog orgSlug={session.organisation.slug} />
        </div>
      </header>

      <LeadsFilterBar filters={filters} total={total} />

      {!result.success ? (
        <Card className="border-destructive/40 p-6 text-sm text-destructive">
          {result.error}
        </Card>
      ) : (
        <LeadsTable leads={leads} organisationId={session.organisation.id} />
      )}
    </div>
  );
}
