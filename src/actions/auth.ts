"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loginSchema, signupSchema } from "@/lib/validations/auth";
import { type ActionResult, fail, ok } from "@/types/action";
import type { Organisation } from "@/types/organisation";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export async function signUp(
  input: unknown,
): Promise<ActionResult<{ userId: string; organisationId: string }>> {
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { email, password, organisationName } = parsed.data;
  const supabase = await createClient();

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
  });

  if (authError) return fail(authError.message);
  if (!authData.user) return fail("Could not create user");

  const baseSlug = slugify(organisationName) || "org";
  const uniqueSlug = `${baseSlug}-${authData.user.id.slice(0, 8)}`;

  // Admin client bypasses RLS. Required because the user's session isn't bound
  // to this request yet (and won't be at all if email confirmation is on),
  // so the standard cookie client would insert as `anon` and trip the
  // `organisations_insert_own` policy. We control owner_id server-side from
  // the just-created auth user, so multi-tenancy is still enforced.
  const admin = createAdminClient();
  const { data: org, error: orgError } = await admin
    .from("organisations")
    .insert({
      name: organisationName,
      slug: uniqueSlug,
      owner_id: authData.user.id,
    })
    .select("id")
    .single<Pick<Organisation, "id">>();

  if (orgError) return fail(orgError.message);

  revalidatePath("/", "layout");
  return ok({ userId: authData.user.id, organisationId: org.id });
}

export async function login(input: unknown): Promise<ActionResult<null>> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) return fail(error.message);

  revalidatePath("/", "layout");
  return ok(null);
}

export async function logout(): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error) return fail(error.message);

  revalidatePath("/", "layout");
  redirect("/login");
}

export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
