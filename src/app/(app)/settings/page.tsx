import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { BolnaIntegrationForm } from "@/components/app/bolna-integration-form";
import { getBolnaIntegration } from "@/actions/bolna-integrations";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Settings · Skello" };

export default async function SettingsPage() {
  const session = await requireSession();
  const integrationResult = await getBolnaIntegration(session.organisation.id);
  const integration = integrationResult.success ? integrationResult.data : null;

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
          <CardTitle>Bolna integration</CardTitle>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Connect your Bolna account to place outbound calls from Skello.
            Each workspace uses its own agent and API key.
          </p>
        </CardHeader>
        <CardContent>
          <BolnaIntegrationForm
            organisationId={session.organisation.id}
            integration={integration}
          />
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
