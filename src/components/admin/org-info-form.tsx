"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { updateOrganisationAdmin } from "@/actions/admin/organisations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Organisation } from "@/types/organisation";

interface Props {
  organisation: Organisation;
}

/**
 * Slug edits propagate to `leads.org_slug` via the FK's ON UPDATE CASCADE.
 * We render it read-only by default and let admins unlock it with an explicit
 * confirmation — renaming a slug affects every lead row under the org.
 */
export function OrgInfoForm({ organisation }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState(organisation.name);
  const [slug, setSlug] = React.useState(organisation.slug);
  const [slugUnlocked, setSlugUnlocked] = React.useState(false);

  const dirty =
    name.trim() !== organisation.name || slug.trim() !== organisation.slug;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!dirty) {
      toast.info("No changes to save");
      return;
    }
    const patch: { id: string; name?: string; slug?: string } = {
      id: organisation.id,
    };
    if (name.trim() !== organisation.name) patch.name = name.trim();
    if (slug.trim() !== organisation.slug) patch.slug = slug.trim();

    startTransition(async () => {
      const result = await updateOrganisationAdmin(patch);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Organisation updated");
      setSlugUnlocked(false);
      router.refresh();
    });
  }

  function onUnlockSlug() {
    if (
      confirm(
        "Editing the slug renames the org's FK on every lead row. Continue?",
      )
    ) {
      setSlugUnlocked(true);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="admin-org-name">Name</Label>
        <Input
          id="admin-org-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={pending}
          maxLength={100}
          required
        />
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="admin-org-slug">Slug</Label>
          {!slugUnlocked ? (
            <button
              type="button"
              onClick={onUnlockSlug}
              className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
            >
              Edit slug
            </button>
          ) : null}
        </div>
        <Input
          id="admin-org-slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          disabled={pending || !slugUnlocked}
          maxLength={63}
          pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
          required
        />
        <p className="text-[11px] text-muted-foreground">
          Lowercase, numbers, hyphens. Cascades to every lead row.
        </p>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !dirty}>
          {pending ? <Loader2Icon className="animate-spin" /> : null}
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
