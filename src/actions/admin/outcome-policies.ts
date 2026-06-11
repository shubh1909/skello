"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { normalizeOutcomeKey } from "@/lib/bolna/extract";
import { requireAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionResult, fail, ok } from "@/types/action";
import type { OutcomePolicy } from "@/types/outcome-policy";

const POLICY_COLUMNS =
  "id, organisation_id, outcome_key, label, action, counts_as_success, position, is_fallback, created_at, updated_at";

const actionSchema = z.enum(["succeed", "fail", "callback", "retry"]);

const createSchema = z.object({
  organisation_id: z.string().uuid(),
  // Raw label/key from the admin; normalised server-side so it matches the
  // agent's emitted value the same way the ingest path normalises it.
  outcome_key: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(80),
  action: actionSchema,
  counts_as_success: z.boolean().default(false),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  organisation_id: z.string().uuid(),
  label: z.string().trim().min(1).max(80).optional(),
  action: actionSchema.optional(),
  counts_as_success: z.boolean().optional(),
  position: z.number().int().min(0).max(1000).optional(),
});

function revalidate(orgId: string) {
  revalidatePath(`/admin/organisations/${orgId}/outcomes`);
}

export async function listOutcomePolicies(
  organisationId: unknown,
): Promise<ActionResult<OutcomePolicy[]>> {
  await requireAdmin();
  if (typeof organisationId !== "string") return fail("Invalid organisation id");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("org_outcome_policies")
    .select(POLICY_COLUMNS)
    .eq("organisation_id", organisationId)
    .order("position", { ascending: true })
    .returns<OutcomePolicy[]>();

  if (error) return fail(error.message);
  return ok(data ?? []);
}

export async function createOutcomePolicy(
  input: unknown,
): Promise<ActionResult<OutcomePolicy>> {
  await requireAdmin();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const key = normalizeOutcomeKey(parsed.data.outcome_key);
  if (!key) {
    return fail("Outcome key must contain at least one letter or number.");
  }

  const admin = createAdminClient();

  // Append after the current last row for a stable display order.
  const { data: last } = await admin
    .from("org_outcome_policies")
    .select("position")
    .eq("organisation_id", parsed.data.organisation_id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle<{ position: number }>();
  const nextPosition = (last?.position ?? -1) + 1;

  const { data, error } = await admin
    .from("org_outcome_policies")
    .insert({
      organisation_id: parsed.data.organisation_id,
      outcome_key: key,
      label: parsed.data.label,
      action: parsed.data.action,
      counts_as_success: parsed.data.counts_as_success,
      position: nextPosition,
      is_fallback: false,
    })
    .select(POLICY_COLUMNS)
    .single<OutcomePolicy>();

  if (error) {
    // Unique (organisation_id, outcome_key) violation → friendly message.
    if (error.code === "23505") {
      return fail(`An outcome with the key "${key}" already exists.`);
    }
    return fail(error.message);
  }

  revalidate(parsed.data.organisation_id);
  return ok(data);
}

export async function updateOutcomePolicy(
  input: unknown,
): Promise<ActionResult<OutcomePolicy>> {
  await requireAdmin();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { id, organisation_id, ...patch } = parsed.data;
  if (Object.keys(patch).length === 0) return fail("No fields to update");

  const admin = createAdminClient();
  // Note: outcome_key and is_fallback are intentionally immutable — renaming a
  // key would orphan historical calls, and the fallback is reserved.
  const { data, error } = await admin
    .from("org_outcome_policies")
    .update(patch)
    .eq("id", id)
    .eq("organisation_id", organisation_id)
    .select(POLICY_COLUMNS)
    .single<OutcomePolicy>();

  if (error) return fail(error.message);
  revalidate(organisation_id);
  return ok(data);
}

export async function deleteOutcomePolicy(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const parsed = z
    .object({ id: z.string().uuid(), organisation_id: z.string().uuid() })
    .safeParse(input);
  if (!parsed.success) return fail("Invalid input");

  const admin = createAdminClient();

  // Never delete the reserved fallback — it's the safety net for any label the
  // agent emits that isn't configured.
  const { data: row } = await admin
    .from("org_outcome_policies")
    .select("is_fallback")
    .eq("id", parsed.data.id)
    .eq("organisation_id", parsed.data.organisation_id)
    .maybeSingle<{ is_fallback: boolean }>();
  if (!row) return fail("Outcome not found");
  if (row.is_fallback) {
    return fail("The fallback outcome can't be deleted.");
  }

  const { error } = await admin
    .from("org_outcome_policies")
    .delete()
    .eq("id", parsed.data.id)
    .eq("organisation_id", parsed.data.organisation_id);

  if (error) return fail(error.message);
  revalidate(parsed.data.organisation_id);
  return ok({ id: parsed.data.id });
}
