import Link from "next/link";
import { UploadCloudIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { VoiceAgentStatusCard } from "@/components/app/voice-agent-status-card";
import { ShopifyStatusCard } from "@/components/app/shopify-status-card";
import { WhatsAppStatusCard } from "@/components/app/whatsapp-status-card";
import { getBolnaIntegration } from "@/actions/bolna-integrations";
import { getWhatsAppIntegration } from "@/actions/whatsapp-integrations";
import { getShopifyStatus } from "@/actions/shopify";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Settings · Skelo" };

export default async function SettingsPage() {
  const session = await requireSession();
  const [integrationResult, whatsappResult, shopifyResult] = await Promise.all([
    getBolnaIntegration(session.organisation.id),
    getWhatsAppIntegration(session.organisation.id),
    getShopifyStatus(),
  ]);
  const integration = integrationResult.success ? integrationResult.data : null;
  const whatsappIntegration = whatsappResult.success
    ? whatsappResult.data
    : null;
  const shopifyStatus = shopifyResult.success ? shopifyResult.data : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1.5">
        <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
          Settings
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Manage your workspace and account.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="org-name">Name</Label>
            <Input id="org-name" defaultValue={session.organisation.name} disabled />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="org-slug">Slug</Label>
            <Input id="org-slug" defaultValue={session.organisation.slug} disabled />
          </div>
          <p className="text-xs text-muted-foreground">
            Workspace edits are locked in this preview build.
          </p>
        </CardContent>
      </Card>

      <Separator />

      <VoiceAgentStatusCard integration={integration} />

      <p className="text-xs leading-relaxed text-muted-foreground">
        Voice agents and lead fields are configured by your Skelo onboarding
        team. Reach out to support if you need a change.
      </p>

      <Separator />

      <WhatsAppStatusCard integration={whatsappIntegration} />

      <Separator />

      <ShopifyStatusCard status={shopifyStatus} />

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Data</CardTitle>
          <CardDescription>
            Backfill historical calls from a voice-agent CSV export.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" render={<Link href="/settings/import-calls" />}>
            <UploadCloudIcon /> Import calls from CSV
          </Button>
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="acct-email">Email</Label>
            <Input id="acct-email" defaultValue={session.email} disabled />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
