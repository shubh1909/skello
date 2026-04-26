import { redirect } from "next/navigation";

import { Logo } from "@/components/brand/logo";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createOrganisation, listOrganisations } from "@/actions/organisations";
import { getCurrentUser } from "@/actions/auth";
import { getIsAdmin } from "@/lib/auth/admin";

export const metadata = { title: "Set up workspace · Skello" };

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Platform admins don't need their own workspace — send them home.
  if (await getIsAdmin()) redirect("/admin");

  const orgsResult = await listOrganisations();
  if (orgsResult.success && orgsResult.data.length > 0) {
    redirect("/dashboard");
  }

  async function action(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;
    const result = await createOrganisation({
      name,
      slug: `${slugify(name) || "workspace"}-${Date.now().toString(36).slice(-6)}`,
    });
    if (result.success) redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="border-b border-border/60 bg-background px-6 py-4">
        <Logo />
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <Card className="p-8">
          <div className="mb-6 space-y-1.5">
            <h1 className="font-heading text-xl font-semibold leading-tight tracking-tight">
              Create your workspace
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              You don&apos;t have an organisation yet. Name it and we&apos;ll
              spin one up.
            </p>
          </div>
          <form action={action} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="name">Workspace name</Label>
              <Input
                id="name"
                name="name"
                placeholder="Acme Inc."
                required
                maxLength={100}
              />
            </div>
            <Button type="submit">Create workspace</Button>
          </form>
        </Card>
      </main>
    </div>
  );
}
