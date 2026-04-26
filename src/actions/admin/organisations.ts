"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionResult, fail, ok } from "@/types/action";
import type { Organisation } from "@/types/organisation";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(200).default(100),
  offset: z.number().int().min(0).default(0),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(100).optional(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(63)
    .regex(slugRegex, "Slug must be lowercase, numbers and hyphens only")
    .optional(),
});

export interface AdminOrganisationRow extends Organisation {
  owner_email: string | null;
  voice_agent_connected: boolean;
  voice_agent_enabled: boolean;
  voice_agent_connected_at: string | null;
  lead_count: number;
}

export async function listAllOrganisations(
  input: unknown,
): Promise<ActionResult<{ items: AdminOrganisationRow[]; total: number }>> {
  await requireAdmin();
  const parsed = listSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { q, limit, offset } = parsed.data;
  const admin = createAdminClient();

  let query = admin
    .from("organisations")
    .select("id, name, slug, owner_id, created_at, updated_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (q) {
    const safe = q.replace(/[%,]/g, " ").trim();
    query = query.or(`name.ilike.%${safe}%,slug.ilike.%${safe}%`);
  }

  const { data, error, count } = await query.returns<Organisation[]>();
  if (error) return fail(error.message);

  const orgs = data ?? [];
  if (orgs.length === 0) return ok({ items: [], total: count ?? 0 });

  const orgIds = orgs.map((o) => o.id);
  const ownerIds = [...new Set(orgs.map((o) => o.owner_id))];

  const [integrationsRes, emailsMap, leadCountsMap] = await Promise.all([
    admin
      .from("bolna_integrations")
      .select("organisation_id, enabled, created_at")
      .in("organisation_id", orgIds)
      .returns<
        { organisation_id: string; enabled: boolean; created_at: string }[]
      >(),
    fetchOwnerEmails(ownerIds),
    fetchLeadCounts(
      orgs.map((o) => o.slug),
    ),
  ]);

  if (integrationsRes.error) return fail(integrationsRes.error.message);
  const intByOrg = new Map(
    (integrationsRes.data ?? []).map((r) => [r.organisation_id, r]),
  );

  const items: AdminOrganisationRow[] = orgs.map((o) => {
    const integration = intByOrg.get(o.id);
    return {
      ...o,
      owner_email: emailsMap.get(o.owner_id) ?? null,
      voice_agent_connected: Boolean(integration),
      voice_agent_enabled: integration?.enabled ?? false,
      voice_agent_connected_at: integration?.created_at ?? null,
      lead_count: leadCountsMap.get(o.slug) ?? 0,
    };
  });

  return ok({ items, total: count ?? 0 });
}

export async function getOrganisationAdmin(
  id: unknown,
): Promise<ActionResult<AdminOrganisationRow>> {
  await requireAdmin();
  if (typeof id !== "string") return fail("Invalid organisation id");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organisations")
    .select("id, name, slug, owner_id, created_at, updated_at")
    .eq("id", id)
    .maybeSingle<Organisation>();

  if (error) return fail(error.message);
  if (!data) return fail("Organisation not found");

  const [integrationRes, emailsMap, leadCountsMap] = await Promise.all([
    admin
      .from("bolna_integrations")
      .select("enabled, created_at")
      .eq("organisation_id", data.id)
      .maybeSingle<{ enabled: boolean; created_at: string }>(),
    fetchOwnerEmails([data.owner_id]),
    fetchLeadCounts([data.slug]),
  ]);

  return ok({
    ...data,
    owner_email: emailsMap.get(data.owner_id) ?? null,
    voice_agent_connected: Boolean(integrationRes.data),
    voice_agent_enabled: integrationRes.data?.enabled ?? false,
    voice_agent_connected_at: integrationRes.data?.created_at ?? null,
    lead_count: leadCountsMap.get(data.slug) ?? 0,
  });
}

export async function updateOrganisationAdmin(
  input: unknown,
): Promise<ActionResult<Organisation>> {
  await requireAdmin();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { id, ...patch } = parsed.data;
  if (Object.keys(patch).length === 0) return fail("No fields to update");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organisations")
    .update(patch)
    .eq("id", id)
    .select("id, name, slug, owner_id, created_at, updated_at")
    .single<Organisation>();

  if (error) return fail(error.message);
  revalidatePath("/admin/organisations");
  revalidatePath(`/admin/organisations/${id}`);
  return ok(data);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fetchOwnerEmails(
  ownerIds: string[],
): Promise<Map<string, string>> {
  if (ownerIds.length === 0) return new Map();
  const admin = createAdminClient();
  const emails = new Map<string, string>();

  // Supabase Admin API — list users in pages. For a small-tenant admin
  // console this is fine; paginate if the auth user count gets huge.
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (error) {
    console.error("[admin] listUsers failed", error);
    return emails;
  }
  for (const u of data.users) {
    if (ownerIds.includes(u.id) && u.email) emails.set(u.id, u.email);
  }
  return emails;
}

async function fetchLeadCounts(
  orgSlugs: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (orgSlugs.length === 0) return counts;
  const admin = createAdminClient();

  // One grouped query via the admin client — service role bypasses RLS.
  const { data, error } = await admin
    .from("leads")
    .select("org_slug", { count: "exact", head: false })
    .in("org_slug", orgSlugs);

  if (error) {
    console.error("[admin] lead counts failed", error);
    return counts;
  }

  for (const row of (data ?? []) as { org_slug: string | null }[]) {
    if (!row.org_slug) continue;
    counts.set(row.org_slug, (counts.get(row.org_slug) ?? 0) + 1);
  }
  return counts;
}
