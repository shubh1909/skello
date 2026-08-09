import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { ErrorCard } from "@/components/app/error-card";
import { SectionLabel } from "@/components/app/section-label";
import { Button } from "@/components/ui/button";
import { OutcomePoliciesEditor } from "@/components/admin/outcome-policies-editor";
import { getOrganisationAdmin } from "@/actions/admin/organisations";
import { listOutcomePolicies } from "@/actions/admin/outcome-policies";
import { requireAdmin } from "@/lib/auth/admin";

export const metadata = { title: "Call outcomes · Admin · Skelo" };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminOrganisationOutcomesPage({
  params,
}: PageProps) {
  await requireAdmin();
  const { id } = await params;

  const [orgRes, policiesRes] = await Promise.all([
    getOrganisationAdmin(id),
    listOutcomePolicies(id),
  ]);

  if (!orgRes.success) {
    if (orgRes.error === "Organisation not found") notFound();
    return (
      <ErrorCard>
        {orgRes.error}
      </ErrorCard>
    );
  }
  if (!policiesRes.success) {
    return (
      <ErrorCard>
        {policiesRes.error}
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
          Call outcomes
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Define what each conversation outcome does to a campaign contact —
          end it as a success, end without retry, schedule a callback, or retry
          later — and which outcomes count toward the campaign success rate.
          The voice agent must emit these outcome keys for the rules to apply.
        </p>
      </header>

      <OutcomePoliciesEditor
        organisationId={org.id}
        policies={policiesRes.data}
      />
    </div>
  );
}
