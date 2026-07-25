"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionResult, fail, ok } from "@/types/action";

export interface CodAgentAdminData {
  // The COD-confirmation agent override (shopify_cod_settings.agent_id).
  agentId: string | null;
  // The org's default voice agent (bolna_integrations.agent_id) — used when the
  // override is null. Shown so the admin knows what "Default" resolves to.
  defaultAgentId: string | null;
  // The org's registered voice agents to pick from.
  agents: Array<{ agent_id: string; label: string | null }>;
}

// Read the COD agent override + the org's agent registry. Admin-only.
export async function getCodAgentAdmin(
  organisationId: unknown,
): Promise<ActionResult<CodAgentAdminData>> {
  await requireAdmin();
  if (typeof organisationId !== "string") {
    return fail("Invalid organisation id");
  }

  const admin = createAdminClient();
  const [settingsRes, bolnaRes, agentsRes] = await Promise.all([
    admin
      .from("shopify_cod_settings")
      .select("agent_id")
      .eq("organisation_id", organisationId)
      .maybeSingle<{ agent_id: string | null }>(),
    admin
      .from("bolna_integrations")
      .select("agent_id")
      .eq("organisation_id", organisationId)
      .maybeSingle<{ agent_id: string | null }>(),
    admin
      .from("voice_agents")
      .select("agent_id, label")
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: true })
      .returns<Array<{ agent_id: string; label: string | null }>>(),
  ]);

  return ok({
    agentId: settingsRes.data?.agent_id ?? null,
    defaultAgentId: bolnaRes.data?.agent_id ?? null,
    agents: agentsRes.data ?? [],
  });
}

const setSchema = z.object({
  organisation_id: z.string().uuid(),
  // Null → clear the override (fall back to the org's default agent).
  agent_id: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

// Set (or clear) the COD-confirmation agent override on shopify_cod_settings.
// Admin-only; upserts so it works before the org has saved any COD settings.
export async function setCodAgentAdmin(
  input: unknown,
): Promise<ActionResult<{ agentId: string | null }>> {
  await requireAdmin();
  const parsed = setSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("shopify_cod_settings")
    .upsert(
      {
        organisation_id: parsed.data.organisation_id,
        agent_id: parsed.data.agent_id,
      },
      { onConflict: "organisation_id" },
    );

  if (error) return fail(error.message);

  revalidatePath(`/admin/organisations/${parsed.data.organisation_id}/shopify`);
  revalidatePath("/campaigns/templates/cod-confirmation");
  return ok({ agentId: parsed.data.agent_id });
}
