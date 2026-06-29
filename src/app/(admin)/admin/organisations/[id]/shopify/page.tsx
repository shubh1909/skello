import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ShopifyConnectForm } from "@/components/admin/shopify-connect-form";
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

  const [orgRes, statusRes] = await Promise.all([
    getOrganisationAdmin(id),
    getShopifyIntegrationStatus({ organisation_id: id }),
  ]);

  if (!orgRes.success) {
    if (orgRes.error === "Organisation not found") notFound();
    return (
      <Card className="border-destructive/40 p-6 text-sm text-destructive">
        {orgRes.error}
      </Card>
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
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {org.name}
        </p>
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
    </div>
  );
}
