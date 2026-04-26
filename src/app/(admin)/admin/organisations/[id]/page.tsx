import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeftIcon,
  Building2Icon,
  HeadphonesIcon,
  UserIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { OrgInfoForm } from "@/components/admin/org-info-form";
import { VoiceAgentForm } from "@/components/admin/voice-agent-form";
import { getOrganisationAdmin } from "@/actions/admin/organisations";
import { getVoiceAgentAdmin } from "@/actions/admin/voice-agent";
import { formatDateTime, formatRelative } from "@/lib/format";

export const metadata = { title: "Organisation · Admin · Skello" };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminOrganisationDetailPage({
  params,
}: PageProps) {
  const { id } = await params;

  const [orgResult, integrationResult] = await Promise.all([
    getOrganisationAdmin(id),
    getVoiceAgentAdmin(id),
  ]);

  if (!orgResult.success) {
    if (orgResult.error === "Organisation not found") notFound();
    return (
      <Card className="border-destructive/40 p-6 text-sm text-destructive">
        {orgResult.error}
      </Card>
    );
  }
  const org = orgResult.data;
  const integration = integrationResult.success ? integrationResult.data : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          render={<Link href="/admin/organisations" />}
        >
          <ArrowLeftIcon /> All organisations
        </Button>
      </div>

      <header className="space-y-1.5">
        <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
          {org.name}
        </h1>
        <p className="font-mono text-xs text-muted-foreground">{org.slug}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Created {formatRelative(org.created_at)} · Owner:{" "}
          {org.owner_email ?? "—"} · {org.lead_count.toLocaleString()} leads
        </p>
      </header>

      <Separator />

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2Icon className="size-4 text-muted-foreground" />
              <CardTitle>Organisation info</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">
              Editable fields for name and slug. The slug cascades to every
              lead row via the FK — don&apos;t rename casually.
            </p>
          </CardHeader>
          <CardContent>
            <OrgInfoForm organisation={org} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <HeadphonesIcon className="size-4 text-muted-foreground" />
              <CardTitle>Voice agent</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">
              Provision the outbound agent for this workspace. The owner sees a
              read-only status card in Settings — all config lives here.
            </p>
          </CardHeader>
          <CardContent>
            <VoiceAgentForm organisationId={org.id} integration={integration} />
            {integration ? (
              <p className="mt-3 text-[11px] text-muted-foreground">
                Connected {formatDateTime(integration.created_at)}, last
                updated {formatRelative(integration.updated_at)}.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <UserIcon className="size-4 text-muted-foreground" />
            <CardTitle>Owner</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-xs text-muted-foreground">Email</dt>
            <dd className="truncate">{org.owner_email ?? "—"}</dd>
            <dt className="text-xs text-muted-foreground">User ID</dt>
            <dd className="font-mono text-xs text-muted-foreground">
              {org.owner_id}
            </dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
