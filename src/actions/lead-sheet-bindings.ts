"use server";

import { revalidatePath } from "next/cache";

import { requireUser, userCanManageOrg } from "@/lib/auth/org-access";
import { requireSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  deleteLeadSheetBindingSchema,
  listLeadSheetBindingsSchema,
  upsertLeadSheetBindingSchema,
} from "@/lib/validations/lead-sheet-binding";
import { type ActionResult, fail, ok } from "@/types/action";
import type { LeadSheetBinding } from "@/types/lead-sheet-binding";

const COLUMNS =
  "id, organisation_id, slot, slot_position, label, " +
  "source_column, category, key_path, " +
  "caption_source_column, caption_category, caption_key_path, caption_static, " +
  "format, created_at, updated_at";

/**
 * The lead sheet's own read: bindings for the signed-in user's org.
 *
 * Cookie client on purpose — RLS is the tenancy gate here, and this runs on the
 * hot path for every ordinary user, not just admins. No organisation_id comes
 * from the caller; it is resolved from the session (Law #1).
 */
export async function listLeadSheetBindings(): Promise<
  ActionResult<LeadSheetBinding[]>
> {
  const session = await requireSession();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("lead_sheet_bindings")
    .select(COLUMNS)
    .eq("organisation_id", session.organisation.id)
    .order("slot", { ascending: true })
    .order("slot_position", { ascending: true })
    .returns<LeadSheetBinding[]>();

  if (error) return fail(error.message);
  return ok(data ?? []);
}

/** Admin read for the layout editor. Takes an explicit org. */
export async function listLeadSheetBindingsForOrg(
  input: unknown,
): Promise<ActionResult<LeadSheetBinding[]>> {
  const parsed = listLeadSheetBindingsSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userCanManageOrg(supabase, user.id, parsed.data.organisation_id))) {
    return fail("Forbidden");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("lead_sheet_bindings")
    .select(COLUMNS)
    .eq("organisation_id", parsed.data.organisation_id)
    .order("slot", { ascending: true })
    .order("slot_position", { ascending: true })
    .returns<LeadSheetBinding[]>();

  if (error) return fail(error.message);
  return ok(data ?? []);
}

/**
 * Write one binding into its (slot, slot_position) cell.
 *
 * Upsert rather than insert-or-update: the cell is the identity. An admin
 * re-binding "card 2" is replacing what is in that cell, not accumulating a
 * second row that the unique index would reject anyway.
 */
export async function upsertLeadSheetBinding(
  input: unknown,
): Promise<ActionResult<LeadSheetBinding>> {
  const parsed = upsertLeadSheetBindingSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userCanManageOrg(supabase, user.id, parsed.data.organisation_id))) {
    return fail("Forbidden");
  }

  const v = parsed.data;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("lead_sheet_bindings")
    .upsert(
      {
        organisation_id: v.organisation_id,
        slot: v.slot,
        slot_position: v.slot_position,
        label: v.label,
        source_column: v.source_column,
        category: v.category,
        key_path: v.key_path,
        // Normalised to null together. The DB's caption CHECK rejects a
        // half-set pair, and Zod already refused it — this just keeps an
        // explicit `undefined` from being sent as a missing column on update.
        caption_source_column: v.caption_source_column ?? null,
        caption_category: v.caption_category,
        caption_key_path: v.caption_key_path ?? null,
        caption_static: v.caption_static ?? null,
        format: v.format,
      },
      { onConflict: "organisation_id,slot,slot_position" },
    )
    .select(COLUMNS)
    .single<LeadSheetBinding>();

  if (error) return fail(error.message);

  revalidatePath(`/admin/organisations/${v.organisation_id}/lead-fields`);
  revalidatePath("/leads");
  return ok(data);
}

export async function deleteLeadSheetBinding(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = deleteLeadSheetBindingSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userCanManageOrg(supabase, user.id, parsed.data.organisation_id))) {
    return fail("Forbidden");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("lead_sheet_bindings")
    .delete()
    .eq("id", parsed.data.id)
    .eq("organisation_id", parsed.data.organisation_id);

  if (error) return fail(error.message);

  revalidatePath(`/admin/organisations/${parsed.data.organisation_id}/lead-fields`);
  revalidatePath("/leads");
  return ok({ id: parsed.data.id });
}
