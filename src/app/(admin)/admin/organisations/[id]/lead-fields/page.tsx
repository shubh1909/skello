import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { ErrorCard } from "@/components/app/error-card";
import { SectionLabel } from "@/components/app/section-label";
import { Button } from "@/components/ui/button";
import { LeadFieldsCatalogManager } from "@/components/app/lead-fields-catalog-manager";
import { getOrganisationAdmin } from "@/actions/admin/organisations";
import { listLeadFieldDefinitions } from "@/actions/lead-field-definitions";
import { requireAdmin } from "@/lib/auth/admin";

export const metadata = { title: "Lead fields · Admin · Skelo" };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminOrganisationLeadFieldsPage({
  params,
}: PageProps) {
  await requireAdmin();
  const { id } = await params;

  const [orgRes, fieldsRes] = await Promise.all([
    getOrganisationAdmin(id),
    listLeadFieldDefinitions({
      organisation_id: id,
      visible_only: false,
    }),
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
        <SectionLabel as="p">
          {org.name}
        </SectionLabel>
        <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
          Lead fields
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Every field this workspace&apos;s voice agent extracts shows up
          here. Decide which ones appear as columns on the leads table,
          rename them, and tune the data type. New fields appear
          automatically the first time they&apos;re captured on a call.
        </p>
      </header>

      <LeadFieldsCatalogManager
        organisationId={org.id}
        definitions={fieldsRes.data}
      />
    </div>
  );
}
