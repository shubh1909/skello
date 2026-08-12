import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { ErrorCard } from "@/components/app/error-card";
import { NavTabs } from "@/components/app/nav-tabs";
import { SectionLabel } from "@/components/app/section-label";
import { Button } from "@/components/ui/button";
import { LeadFieldsCatalogManager } from "@/components/app/lead-fields-catalog-manager";
import { LeadSheetLayoutManager } from "@/components/app/lead-sheet-layout-manager";
// From lib/, NOT from the editor component: that file is `"use client"`, and a
// Server Component importing a plain object across that boundary receives a
// client reference whose properties read as undefined.
import { LEAD_SHEET_SLOT_INFO } from "@/lib/leads/sheet-slots";
import type { LeadSheetSlot } from "@/types/lead-sheet-binding";
import { getOrganisationAdmin } from "@/actions/admin/organisations";
import { listLeadFieldDefinitions } from "@/actions/lead-field-definitions";
import { listLeadSheetBindingsForOrg } from "@/actions/lead-sheet-bindings";
import { requireAdmin } from "@/lib/auth/admin";

export const metadata = { title: "Lead fields · Admin · Skelo" };

/**
 * The page's four sections, flattened into one tab strip.
 *
 * Deliberately NOT nested (catalog vs. layout, then a slot picker inside
 * layout): the page has four things to configure, and two levels of tabs to
 * reach four screens is more navigation than the content justifies. The
 * catalog tab sits first because the other three can only bind fields it
 * already knows about.
 */
type Section = "fields" | "cards" | "wants" | "header";

const SECTION_SLOT: Record<Exclude<Section, "fields">, LeadSheetSlot> = {
  cards: "stat_card",
  wants: "wants",
  header: "header_meta",
};

const SECTIONS: Section[] = ["fields", "cards", "wants", "header"];

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ section?: string }>;
}

export default async function AdminOrganisationLeadFieldsPage({
  params,
  searchParams,
}: PageProps) {
  await requireAdmin();
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const section: Section =
    SECTIONS.find((s) => s === sp.section) ?? "fields";

  const [orgRes, fieldsRes, bindingsRes] = await Promise.all([
    getOrganisationAdmin(id),
    listLeadFieldDefinitions({
      organisation_id: id,
      visible_only: false,
    }),
    listLeadSheetBindingsForOrg({ organisation_id: id }),
  ]);

  if (!orgRes.success) {
    if (orgRes.error === "Organisation not found") notFound();
    return (
      <ErrorCard>
        {orgRes.error}
      </ErrorCard>
    );
  }
  if (!fieldsRes.success) {
    return (
      <ErrorCard>
        {fieldsRes.error}
      </ErrorCard>
    );
  }

  const org = orgRes.data;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          render={<Link href={`/admin/organisations/${org.id}`} />}
        >
          <ArrowLeftIcon /> Back to {org.name}
        </Button>
      </div>

      <header className="space-y-2">
        <SectionLabel as="p">{org.name}</SectionLabel>
        <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
          Lead fields
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          What this workspace captures, and where it shows up. Every field the
          voice agent extracts appears in the catalog automatically the first
          time it lands on a call; the other three tabs decide which of them the
          lead detail sheet leads with.
        </p>
      </header>

      {/* Same page as the catalog rather than a separate route: the layout
          tabs' options ARE the catalog, so binding a field an admin has just
          renamed shouldn't mean navigating somewhere else to find it. */}
      <NavTabs
        aria-label="Lead field settings"
        items={[
          {
            href: sectionHref(org.id, "fields"),
            label: "Field catalog",
            active: section === "fields",
            count: fieldsRes.data.length,
          },
          ...(Object.keys(SECTION_SLOT) as Array<keyof typeof SECTION_SLOT>).map(
            (key) => {
              const slot = SECTION_SLOT[key];
              return {
                href: sectionHref(org.id, key),
                label: LEAD_SHEET_SLOT_INFO[slot].tab,
                active: section === key,
                // Configured cells, not the maximum — an admin wants to know
                // how much of the slot is filled in, and "0" is the signal
                // that a panel is currently empty on every lead.
                count: bindingsRes.success
                  ? bindingsRes.data.filter((b) => b.slot === slot).length
                  : undefined,
              };
            },
          ),
        ]}
      />

      {section === "fields" ? (
        <>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Decide which fields appear as columns on the leads table, rename
            them, and tune the data type. Renaming here changes the name
            everywhere, including the pickers on the other tabs.
          </p>
          <LeadFieldsCatalogManager
            organisationId={org.id}
            definitions={fieldsRes.data}
          />
        </>
      ) : !bindingsRes.success ? (
        <ErrorCard>{bindingsRes.error}</ErrorCard>
      ) : (
        <>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {LEAD_SHEET_SLOT_INFO[SECTION_SLOT[section]].blurb}
          </p>
          <LeadSheetLayoutManager
            organisationId={org.id}
            bindings={bindingsRes.data}
            definitions={fieldsRes.data}
            slot={SECTION_SLOT[section]}
          />
        </>
      )}
    </div>
  );
}

function sectionHref(orgId: string, section: Section): string {
  const base = `/admin/organisations/${orgId}/lead-fields`;
  return section === "fields" ? base : `${base}?section=${section}`;
}
