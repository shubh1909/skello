import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeftIcon,
  Building2Icon,
  ChevronRightIcon,
  GaugeIcon,
  HeadphonesIcon,
  ShoppingCartIcon,
  SlidersHorizontalIcon,
  TargetIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { OrgInfoForm } from "@/components/admin/org-info-form";
import { VoiceAgentForm } from "@/components/admin/voice-agent-form";
import { getOrganisationAdmin } from "@/actions/admin/organisations";
import { getVoiceAgentAdmin } from "@/actions/admin/voice-agent";
import { formatDateTime, formatRelative } from "@/lib/format";

export const metadata = { title: "Organisation · Admin · Skelo" };

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

      <Card className="p-0">
        <CardHeader className="px-6 pt-5">
          <CardTitle>Workspace configuration</CardTitle>
          <p className="text-sm text-muted-foreground">
            Onboarding-time setup. The workspace owner sees these as read-only
            — all management lives here.
          </p>
        </CardHeader>
        <CardContent className="grid gap-0 p-0">
          <Separator />
          <ConfigLink
            href={`/admin/organisations/${org.id}/voice-agents`}
            title="Voice agents"
            description="Link the agents that route inbound calls into this workspace."
            icon={<UsersIcon className="size-4" />}
          />
          <Separator />
          <ConfigLink
            href={`/admin/organisations/${org.id}/lead-fields`}
            title="Lead fields"
            description="Choose which extracted fields appear on the leads table for this workspace."
            icon={<SlidersHorizontalIcon className="size-4" />}
          />
          <Separator />
          <ConfigLink
            href={`/admin/organisations/${org.id}/dashboard`}
            title="Dashboard"
            description="Compose the org's analytics dashboard from a catalogue of stat cards, charts, and pivot tables."
            icon={<GaugeIcon className="size-4" />}
          />
          <Separator />
          <ConfigLink
            href={`/admin/organisations/${org.id}/outcomes`}
            title="Call outcomes"
            description="Configure what each conversation outcome does (succeed / fail / callback / retry) and which count as a success."
            icon={<TargetIcon className="size-4" />}
          />
          <Separator />
          <ConfigLink
            href={`/admin/organisations/${org.id}/shopify`}
            title="Cart Recovery (Shopify)"
            description="Connect the store's Shopify app so abandoned checkouts trigger recovery calls."
            icon={<ShoppingCartIcon className="size-4" />}
          />
        </CardContent>
      </Card>

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

function ConfigLink({
  href,
  title,
  description,
  icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 px-6 py-4 transition-colors hover:bg-muted/40"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight">{title}</p>
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
          {description}
        </p>
      </div>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
