import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { ErrorCard } from "@/components/app/error-card";
import { SectionLabel } from "@/components/app/section-label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CodAgentForm } from "@/components/admin/cod-agent-form";
import { ShopifyConnectForm } from "@/components/admin/shopify-connect-form";
import { getCodAgentAdmin } from "@/actions/admin/cod-confirmation";
import { getOrganisationAdmin } from "@/actions/admin/organisations";
import { getShopifyIntegrationStatus } from "@/actions/admin/shopify";
import { requireAdmin } from "@/lib/auth/admin";

export const metadata = { title: "Cart Recovery · Admin · Skelo" };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminOrganisationShopifyPage({
  params,
}: PageProps) {
  await requireAdmin();
  const { id } = await params;

  const [orgRes, statusRes, codAgentRes] = await Promise.all([
    getOrganisationAdmin(id),
    getShopifyIntegrationStatus({ organisation_id: id }),
    getCodAgentAdmin(id),
  ]);

  if (!orgRes.success) {
    if (orgRes.error === "Organisation not found") notFound();
    return (
      <ErrorCard>
        {orgRes.error}
      </ErrorCard>
    );
  }

  const org = orgRes.data;
  const status = statusRes.success ? statusRes.data : null;

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
          Cart Recovery (Shopify)
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Connect this workspace&apos;s Shopify store so abandoned checkouts flow
          in and the voice agent can call shoppers to recover them. The store
          credentials are stored securely and never shown to the workspace owner.
        </p>
      </header>

      <ShopifyConnectForm organisationId={org.id} status={status} />

      <Card>
        <CardHeader>
          <CardTitle>COD Confirmation</CardTitle>
          <p className="text-sm text-muted-foreground">
            Pick the voice agent that calls Cash-on-Delivery customers to
            reconfirm their order. The workspace owner controls timing and the
            on/off switch under Campaigns → COD Confirmation; the agent is set
            here.
          </p>
        </CardHeader>
        <CardContent>
          {codAgentRes.success ? (
            <CodAgentForm organisationId={org.id} data={codAgentRes.data} />
          ) : (
            <p className="text-sm text-destructive">{codAgentRes.error}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
