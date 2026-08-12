"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  createLeadNoteSchema,
  deleteLeadNoteSchema,
  listLeadNotesSchema,
} from "@/lib/validations/lead-note";
import { type ActionResult, fail, ok } from "@/types/action";
import type { LeadNote } from "@/types/lead-note";

const COLUMNS =
  "id, organisation_id, lead_id, author_id, author_email, body, created_at";

/**
 * Every function here uses the COOKIE client, deliberately.
 *
 * The admin client would bypass both the tenancy check and the "you may only
 * delete your own note" rule, leaving the entire policy to be re-implemented
 * (and eventually mis-implemented) in TypeScript. Notes are small, per-lead and
 * user-authored — exactly the case RLS is for.
 */

export async function listLeadNotes(
  input: unknown,
): Promise<ActionResult<LeadNote[]>> {
  const parsed = listLeadNotesSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const session = await requireSession();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("lead_notes")
    .select(COLUMNS)
    .eq("organisation_id", session.organisation.id)
    .eq("lead_id", parsed.data.lead_id)
    .order("created_at", { ascending: false })
    .limit(parsed.data.limit)
    .returns<LeadNote[]>();

  if (error) return fail(error.message);
  return ok(data ?? []);
}

export async function createLeadNote(
  input: unknown,
): Promise<ActionResult<LeadNote>> {
  const parsed = createLeadNoteSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const session = await requireSession();
  const supabase = await createClient();

  // Confirm the lead is this org's and still live before writing. Without it a
  // note could be attached to another tenant's lead id — the insert policy
  // checks the note's organisation_id, which the client would be supplying.
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", parsed.data.lead_id)
    .eq("organisation_id", session.organisation.id)
    .is("deleted_at", null)
    .maybeSingle<{ id: string }>();
  if (!lead) return fail("Lead not found");

  const { data, error } = await supabase
    .from("lead_notes")
    .insert({
      organisation_id: session.organisation.id,
      lead_id: parsed.data.lead_id,
      author_id: session.userId,
      // Denormalised: author_id goes null if the account is removed, and who
      // said it is the half worth keeping.
      author_email: session.email || null,
      body: parsed.data.body,
    })
    .select(COLUMNS)
    .single<LeadNote>();

  if (error) return fail(error.message);

  revalidatePath("/leads");
  return ok(data);
}

/**
 * Delete your own note. The RLS policy is the actual gate — there is no
 * app-side author check here because duplicating it would only create a second
 * place for the rule to drift.
 */
export async function deleteLeadNote(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = deleteLeadNoteSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  await requireSession();
  const supabase = await createClient();

  // `select` after delete so a policy-blocked delete (someone else's note)
  // comes back as zero rows rather than a silent success.
  const { data, error } = await supabase
    .from("lead_notes")
    .delete()
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) return fail(error.message);
  if (!data) return fail("Note not found, or not yours to delete");

  revalidatePath("/leads");
  return ok({ id: data.id });
}
