"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  organisationCreateSchema,
  organisationIdSchema,
  organisationUpdateSchema,
} from "@/lib/validations/organisation";
import { type ActionResult, fail, ok } from "@/types/action";
import type { Organisation } from "@/types/organisation";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null };
  return { supabase, user };
}

export async function createOrganisation(
  input: unknown,
): Promise<ActionResult<Organisation>> {
  const parsed = organisationCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");

  const { data, error } = await supabase
    .from("organisations")
    .insert({ ...parsed.data, owner_id: user.id })
    .select("*")
    .single<Organisation>();

  if (error) return fail(error.message);

  revalidatePath("/organisations");
  return ok(data);
}

export async function listOrganisations(): Promise<ActionResult<Organisation[]>> {
  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");

  const { data, error } = await supabase
    .from("organisations")
    .select("id, name, slug, owner_id, created_at, updated_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .returns<Organisation[]>();

  if (error) return fail(error.message);
  return ok(data);
}

export async function getOrganisation(
  id: unknown,
): Promise<ActionResult<Organisation>> {
  const parsed = organisationIdSchema.safeParse(id);
  if (!parsed.success) return fail("Invalid organisation id");

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");

  const { data, error } = await supabase
    .from("organisations")
    .select("id, name, slug, owner_id, created_at, updated_at")
    .eq("id", parsed.data)
    .eq("owner_id", user.id)
    .maybeSingle<Organisation>();

  if (error) return fail(error.message);
  if (!data) return fail("Organisation not found");
  return ok(data);
}

export async function updateOrganisation(
  id: unknown,
  input: unknown,
): Promise<ActionResult<Organisation>> {
  const idParsed = organisationIdSchema.safeParse(id);
  if (!idParsed.success) return fail("Invalid organisation id");

  const parsed = organisationUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  if (Object.keys(parsed.data).length === 0) {
    return fail("No fields to update");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");

  const { data, error } = await supabase
    .from("organisations")
    .update(parsed.data)
    .eq("id", idParsed.data)
    .eq("owner_id", user.id)
    .select("*")
    .maybeSingle<Organisation>();

  if (error) return fail(error.message);
  if (!data) return fail("Organisation not found");

  revalidatePath("/organisations");
  revalidatePath(`/organisations/${idParsed.data}`);
  return ok(data);
}

export async function deleteOrganisation(
  id: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = organisationIdSchema.safeParse(id);
  if (!parsed.success) return fail("Invalid organisation id");

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");

  const { data, error } = await supabase
    .from("organisations")
    .delete()
    .eq("id", parsed.data)
    .eq("owner_id", user.id)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) return fail(error.message);
  if (!data) return fail("Organisation not found");

  revalidatePath("/organisations");
  return ok({ id: data.id });
}
