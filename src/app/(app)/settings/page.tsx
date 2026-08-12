import Link from "next/link";
import { PlugZapIcon, UploadCloudIcon } from "lucide-react";

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
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Settings · Skelo" };

/**
 * Workspace, data and account.
 *
 * The voice-agent, WhatsApp and Shopify connection cards used to live here,
 * below the workspace form — which put "where do my leads come from" in the
 * same place as "change my email", and left no room for the setup instructions
 * and delivery logs a webhook integration needs. They now have /integrations.
 */
export default async function SettingsPage() {
  const session = await requireSession();

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

      <Card>
        <CardHeader>
          <CardTitle>Connections</CardTitle>
          <CardDescription>
            Your voice agent, lead sources and connected stores now live on their
            own page, with setup steps and a delivery log for each.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" render={<Link href="/integrations" />}>
            <PlugZapIcon /> Open Integrations
          </Button>
        </CardContent>
      </Card>

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
