"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  reminderCreateSchema,
  reminderIdSchema,
  reminderListSchema,
  reminderUpdateSchema,
} from "@/lib/validations/reminder";
import { type ActionResult, fail, ok } from "@/types/action";
import type { Reminder } from "@/types/reminder";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

async function userOwnsOrg(
  supabase: SupabaseServerClient,
  userId: string,
  organisationId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("organisations")
    .select("id")
    .eq("id", organisationId)
    .eq("owner_id", userId)
    .maybeSingle<{ id: string }>();
  return !!data;
}

// Used by read-by-id paths so the reminder query is scoped to the
// caller's org BEFORE the row is fetched, avoiding the existence
// oracle on cross-tenant UUIDs.
async function getUserOwnedOrg(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from("organisations")
    .select("id")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>();
  return data ?? null;
}

async function leadBelongsToOrg(
  supabase: SupabaseServerClient,
  leadId: string,
  organisationId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("organisation_id", organisationId)
    .maybeSingle<{ id: string }>();
  return !!data;
}

export async function listReminders(
  input: unknown,
): Promise<ActionResult<{ items: Reminder[]; total: number }>> {
  const parsed = reminderListSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { organisation_id, limit, offset, status, type, lead_id, from, to } =
    parsed.data;

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userOwnsOrg(supabase, user.id, organisation_id))) {
    return fail("Forbidden");
  }

  let query = supabase
    .from("reminders")
    .select("*", { count: "exact" })
    .eq("organisation_id", organisation_id)
    .order("remind_at", { ascending: true })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status);
  if (type) query = query.eq("type", type);
  if (lead_id) query = query.eq("lead_id", lead_id);
  if (from) query = query.gte("remind_at", from);
  if (to) query = query.lte("remind_at", to);

  const { data, error, count } = await query.returns<Reminder[]>();
  if (error) return fail(error.message);

  return ok({ items: data, total: count ?? 0 });
}

export async function getReminder(id: unknown): Promise<ActionResult<Reminder>> {
  const parsed = reminderIdSchema.safeParse(id);
  if (!parsed.success) return fail("Invalid reminder id");

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");

  const org = await getUserOwnedOrg(supabase, user.id);
  if (!org) return fail("Reminder not found");

  const { data, error } = await supabase
    .from("reminders")
    .select("*")
    .eq("id", parsed.data)
    .eq("organisation_id", org.id)
    .maybeSingle<Reminder>();

  if (error) return fail(error.message);
  if (!data) return fail("Reminder not found");

  return ok(data);
}

export async function createReminder(
  input: unknown,
): Promise<ActionResult<Reminder>> {
  const parsed = reminderCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userOwnsOrg(supabase, user.id, parsed.data.organisation_id))) {
    return fail("Forbidden");
  }

  if (
    parsed.data.lead_id &&
    !(await leadBelongsToOrg(
      supabase,
      parsed.data.lead_id,
      parsed.data.organisation_id,
    ))
  ) {
    return fail("Lead does not belong to this organisation");
  }

  const { data, error } = await supabase
    .from("reminders")
    .insert({ ...parsed.data, created_by: user.id })
    .select("*")
    .single<Reminder>();

  if (error) return fail(error.message);

  revalidatePath(`/organisations/${parsed.data.organisation_id}/reminders`);
  if (parsed.data.lead_id) {
    revalidatePath(
      `/organisations/${parsed.data.organisation_id}/leads/${parsed.data.lead_id}`,
    );
  }
  return ok(data);
}

export async function updateReminder(
  id: unknown,
  input: unknown,
): Promise<ActionResult<Reminder>> {
  const idParsed = reminderIdSchema.safeParse(id);
  if (!idParsed.success) return fail("Invalid reminder id");

  const parsed = reminderUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  if (Object.keys(parsed.data).length === 0) return fail("No fields to update");

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");

  const org = await getUserOwnedOrg(supabase, user.id);
  if (!org) return fail("Reminder not found");

  const { data: existing, error: fetchErr } = await supabase
    .from("reminders")
    .select("id")
    .eq("id", idParsed.data)
    .eq("organisation_id", org.id)
    .maybeSingle<{ id: string }>();

  if (fetchErr) return fail(fetchErr.message);
  if (!existing) return fail("Reminder not found");

  if (
    parsed.data.lead_id &&
    !(await leadBelongsToOrg(supabase, parsed.data.lead_id, org.id))
  ) {
    return fail("Lead does not belong to this organisation");
  }

  const patch: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.status === "done") patch.completed_at = new Date().toISOString();
  if (parsed.data.status && parsed.data.status !== "done") patch.completed_at = null;

  const { data, error } = await supabase
    .from("reminders")
    .update(patch)
    .eq("id", idParsed.data)
    .eq("organisation_id", org.id)
    .select("*")
    .single<Reminder>();

  if (error) return fail(error.message);

  revalidatePath(`/organisations/${org.id}/reminders`);
  return ok(data);
}

export async function deleteReminder(
  id: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = reminderIdSchema.safeParse(id);
  if (!parsed.success) return fail("Invalid reminder id");

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");

  const org = await getUserOwnedOrg(supabase, user.id);
  if (!org) return fail("Reminder not found");

  const { data: existing, error: fetchErr } = await supabase
    .from("reminders")
    .select("id")
    .eq("id", parsed.data)
    .eq("organisation_id", org.id)
    .maybeSingle<{ id: string }>();

  if (fetchErr) return fail(fetchErr.message);
  if (!existing) return fail("Reminder not found");

  const { error } = await supabase
    .from("reminders")
    .delete()
    .eq("id", parsed.data)
    .eq("organisation_id", org.id);
  if (error) return fail(error.message);

  revalidatePath(`/organisations/${org.id}/reminders`);
  return ok({ id: parsed.data });
}

export async function markReminderDone(
  id: unknown,
): Promise<ActionResult<Reminder>> {
  return updateReminder(id, { status: "done" });
}

export async function markReminderPending(
  id: unknown,
): Promise<ActionResult<Reminder>> {
  return updateReminder(id, { status: "pending" });
}
