import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { ErrorCard } from "@/components/app/error-card";
import { SectionLabel } from "@/components/app/section-label";
import { Button } from "@/components/ui/button";
import { VoiceAgentsManager } from "@/components/app/voice-agents-manager";
import { getOrganisationAdmin } from "@/actions/admin/organisations";
import { getVoiceAgentAdmin } from "@/actions/admin/voice-agent";
import { listVoiceAgents } from "@/actions/voice-agents";
import { requireAdmin } from "@/lib/auth/admin";

export const metadata = { title: "Voice agents · Admin · Skelo" };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminOrganisationVoiceAgentsPage({
  params,
}: PageProps) {
  await requireAdmin();
  const { id } = await params;

  const [orgRes, agentsRes, integrationRes] = await Promise.all([
    getOrganisationAdmin(id),
    listVoiceAgents(id),
    getVoiceAgentAdmin(id),
  ]);

  if (!orgRes.success) {
    if (orgRes.error === "Organisation not found") notFound();
    return (
      <ErrorCard>
        {orgRes.error}
      </ErrorCard>
    );
  }
  if (!agentsRes.success) {
    return (
      <ErrorCard>
        {agentsRes.error}
      </ErrorCard>
    );
  }

  const org = orgRes.data;
  const integration = integrationRes.success ? integrationRes.data : null;
  const defaultAgentId = integration?.agent_id ?? null;
  const integrationReady = Boolean(integration?.enabled);

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
          Voice agents
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Provision the agents that route inbound calls into this workspace.
          One agent can only belong to one workspace; the provider verifies
          ownership before linking.
        </p>
      </header>

      <VoiceAgentsManager
        organisationId={org.id}
        agents={agentsRes.data}
        defaultAgentId={defaultAgentId}
        integrationReady={integrationReady}
      />
    </div>
  );
}
