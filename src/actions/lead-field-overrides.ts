"use server";

import { revalidatePath } from "next/cache";

import { logSkeloError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  listLeadFieldOverridesSchema,
  setLeadFieldOverrideSchema,
  unlockLeadFieldOverrideSchema,
} from "@/lib/validations/lead-field-override";
import { type ActionResult, fail, ok } from "@/types/action";
import type { LeadFieldOverride } from "@/types/lead-field-override";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const COLUMNS =
  "id, lead_id, organisation_id, field_path, action, value, previous_value, reason, edited_by, edited_at";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// Resolves the lead's owning organisation and verifies the caller owns it.
// One round trip; returns the org id so the caller can attach it to the
// override row without a second select.
async function resolveLeadOrg(
  supabase: SupabaseServerClient,
  userId: string,
  leadId: string,
): Promise<{ organisationId: string } | null> {
  const { data } = await supabase
    .from("leads")
    .select("organisation_id, organisations!inner(owner_id)")
    .eq("id", leadId)
    .maybeSingle<{
      organisation_id: string;
      organisations: { owner_id: string };
    }>();
  if (!data) return null;
  if (data.organisations.owner_id !== userId) return null;
  return { organisationId: data.organisation_id };
}

// Resolves the field path on the lead row into its current stored value.
// Used so the audit row's previous_value reflects what the admin actually
// overwrote. Supports both first-class columns (e.g. "name") and JSONB
// paths ("lead_data.city", "custom_data.preferences.budget").
async function readCurrentValue(
  organisationId: string,
  leadId: string,
  fieldPath: string,
): Promise<unknown> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("leads")
    .select("name, current_intent, city, pincode, notes, lead_data, custom_data")
    .eq("id", leadId)
    .eq("organisation_id", organisationId)
    .maybeSingle<{
      name: string | null;
      current_intent: string | null;
      city: string | null;
      pincode: string | null;
      notes: string | null;
      lead_data: Record<string, unknown>;
      custom_data: Record<string, Record<string, unknown>>;
    }>();
  if (!data) return null;

  const parts = fieldPath.split(".");
  if (parts.length === 1) {
    return (data as unknown as Record<string, unknown>)[parts[0]] ?? null;
  }
  const [root, ...rest] = parts;
  const blob =
    root === "lead_data" ? data.lead_data :
    root === "custom_data" ? data.custom_data :
    null;
  if (!blob) return null;
  let cursor: unknown = blob;
  for (const key of rest) {
    if (cursor && typeof cursor === "object" && key in (cursor as object)) {
      cursor = (cursor as Record<string, unknown>)[key];
    } else {
      return null;
    }
  }
  return cursor ?? null;
}

// Writes the new value onto the lead row AND inserts the override event in
// a single round trip. The lead-row write covers both first-class columns
// and JSONB paths (lead_data.x / custom_data.cat.x) via a small RPC.
async function applyOverrideWrite(args: {
  organisationId: string;
  leadId: string;
  fieldPath: string;
  value: unknown;
}): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  const parts = args.fieldPath.split(".");

  if (parts.length === 1) {
    const patch: Record<string, unknown> = { [parts[0]]: args.value };
    const { error } = await admin
      .from("leads")
      .update(patch)
      .eq("id", args.leadId)
      .eq("organisation_id", args.organisationId);
    return { error: error?.message ?? null };
  }

  // JSONB nested path. Use jsonb_set via RPC to avoid clobbering siblings.
  const [root, ...rest] = parts;
  if (root !== "lead_data" && root !== "custom_data") {
    return { error: `Unsupported field path root: ${root}` };
  }
  const { error } = await admin.rpc("apply_lead_field_jsonb", {
    p_lead_id: args.leadId,
    p_org_id: args.organisationId,
    p_column: root,
    p_path: rest,
    p_value: args.value as unknown,
  });
  return { error: error?.message ?? null };
}

export async function setLeadFieldOverride(
  input: unknown,
): Promise<ActionResult<LeadFieldOverride>> {
  const parsed = setLeadFieldOverrideSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  const orgRes = await resolveLeadOrg(supabase, user.id, parsed.data.lead_id);
  if (!orgRes) return fail("Forbidden");

  const previous = await readCurrentValue(
    orgRes.organisationId,
    parsed.data.lead_id,
    parsed.data.field_path,
  );

  const write = await applyOverrideWrite({
    organisationId: orgRes.organisationId,
    leadId: parsed.data.lead_id,
    fieldPath: parsed.data.field_path,
    value: parsed.data.value,
  });
  if (write.error) {
    return fail(
      logSkeloError("OVERRIDE-WRITE-FAIL", "Could not write override value to lead", {
        organisationId: orgRes.organisationId,
        leadId: parsed.data.lead_id,
        fieldPath: parsed.data.field_path,
        userId: user.id,
        cause: write.error,
      }),
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("lead_field_overrides")
    .insert({
      lead_id: parsed.data.lead_id,
      organisation_id: orgRes.organisationId,
      field_path: parsed.data.field_path,
      action: "set" as const,
      value: parsed.data.value,
      previous_value: previous,
      reason: parsed.data.reason ?? null,
      edited_by: user.id,
    })
    .select(COLUMNS)
    .single<LeadFieldOverride>();

  if (error) {
    return fail(
      logSkeloError("OVERRIDE-WRITE-FAIL", "Could not record override audit row", {
        organisationId: orgRes.organisationId,
        leadId: parsed.data.lead_id,
        fieldPath: parsed.data.field_path,
        userId: user.id,
        cause: error,
      }),
    );
  }
  revalidatePath("/leads");
  revalidatePath(`/leads/${parsed.data.lead_id}`);
  return ok(data);
}

// Unlock = tombstone event. The lock-lookup function now returns "no row
// for this field with action='set' as the most recent event", so the
// webhook can write it again on the next call.
export async function unlockLeadFieldOverride(
  input: unknown,
): Promise<ActionResult<LeadFieldOverride>> {
  const parsed = unlockLeadFieldOverrideSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  const orgRes = await resolveLeadOrg(supabase, user.id, parsed.data.lead_id);
  if (!orgRes) return fail("Forbidden");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("lead_field_overrides")
    .insert({
      lead_id: parsed.data.lead_id,
      organisation_id: orgRes.organisationId,
      field_path: parsed.data.field_path,
      action: "unlock" as const,
      value: null,
      previous_value: null,
      reason: parsed.data.reason ?? null,
      edited_by: user.id,
    })
    .select(COLUMNS)
    .single<LeadFieldOverride>();

  if (error) {
    return fail(
      logSkeloError("OVERRIDE-WRITE-FAIL", "Unlock event failed", {
        organisationId: orgRes.organisationId,
        leadId: parsed.data.lead_id,
        fieldPath: parsed.data.field_path,
        userId: user.id,
        cause: error,
      }),
    );
  }
  revalidatePath(`/leads/${parsed.data.lead_id}`);
  return ok(data);
}

export async function listLeadFieldOverrides(
  input: unknown,
): Promise<ActionResult<LeadFieldOverride[]>> {
  const parsed = listLeadFieldOverridesSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  const orgRes = await resolveLeadOrg(supabase, user.id, parsed.data.lead_id);
  if (!orgRes) return fail("Forbidden");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("lead_field_overrides")
    .select(COLUMNS)
    .eq("lead_id", parsed.data.lead_id)
    .order("edited_at", { ascending: false })
    .limit(parsed.data.limit);

  if (error) {
    return fail(
      logSkeloError("OVERRIDE-READ-FAIL", "Could not load override history", {
        organisationId: orgRes.organisationId,
        leadId: parsed.data.lead_id,
        cause: error,
      }),
    );
  }
  return ok((data ?? []) as LeadFieldOverride[]);
}
