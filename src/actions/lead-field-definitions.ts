"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  listLeadFieldDefinitionsSchema,
  updateLeadFieldDefinitionSchema,
} from "@/lib/validations/lead-field-definition";
import { type ActionResult, fail, ok } from "@/types/action";
import type { LeadFieldDefinition } from "@/types/lead-field-definition";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const COLUMNS =
  "id, organisation_id, source_column, category, key_path, label, data_type, " +
  "visible_in_table, filterable, sortable, searchable, display_order, " +
  "sample_value, enum_options, last_seen_at, created_at, updated_at";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

async function userCanManageOrg(
  supabase: SupabaseServerClient,
  userId: string,
  organisationId: string,
): Promise<boolean> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle<{ is_admin: boolean }>();
  if (profile?.is_admin) return true;

  const { data } = await supabase
    .from("organisations")
    .select("id")
    .eq("id", organisationId)
    .eq("owner_id", userId)
    .maybeSingle<{ id: string }>();
  return !!data;
}

export async function listLeadFieldDefinitions(
  input: unknown,
): Promise<ActionResult<LeadFieldDefinition[]>> {
  const parsed = listLeadFieldDefinitionsSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userCanManageOrg(supabase, user.id, parsed.data.organisation_id))) {
    return fail("Forbidden");
  }

  const admin = createAdminClient();
  let query = admin
    .from("lead_field_definitions")
    .select(COLUMNS)
    .eq("organisation_id", parsed.data.organisation_id);

  if (parsed.data.visible_only) query = query.eq("visible_in_table", true);

  const { data, error } = await query
    .order("visible_in_table", { ascending: false })
    .order("display_order", { ascending: true })
    .order("key_path", { ascending: true })
    .returns<LeadFieldDefinition[]>();

  if (error) return fail(error.message);
  return ok(data ?? []);
}

export async function updateLeadFieldDefinition(
  input: unknown,
): Promise<ActionResult<LeadFieldDefinition>> {
  const parsed = updateLeadFieldDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userCanManageOrg(supabase, user.id, parsed.data.organisation_id))) {
    return fail("Forbidden");
  }

  const { id, organisation_id, ...patch } = parsed.data;
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) cleaned[k] = v;
  }
  if (Object.keys(cleaned).length === 0) return fail("No fields to update");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("lead_field_definitions")
    .update(cleaned)
    .eq("id", id)
    .eq("organisation_id", organisation_id)
    .select(COLUMNS)
    .single<LeadFieldDefinition>();

  if (error) return fail(error.message);
  revalidatePath(
    `/admin/organisations/${parsed.data.organisation_id}/lead-fields`,
  );
  revalidatePath("/leads");
  return ok(data);
}
