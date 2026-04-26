"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionResult, fail, ok } from "@/types/action";

export interface AdminUserRow {
  id: string;
  email: string | null;
  display_name: string | null;
  is_admin: boolean;
  created_at: string;
}

const setAdminSchema = z.object({
  user_id: z.string().uuid(),
  is_admin: z.boolean(),
});

export async function listAllUsers(): Promise<ActionResult<AdminUserRow[]>> {
  await requireAdmin();
  const admin = createAdminClient();

  const { data: authList, error: authErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (authErr) return fail(authErr.message);

  const ids = authList.users.map((u) => u.id);
  const { data: profiles, error: profErr } = await admin
    .from("profiles")
    .select("id, is_admin, display_name")
    .in("id", ids)
    .returns<{ id: string; is_admin: boolean; display_name: string | null }[]>();

  if (profErr) return fail(profErr.message);
  const profileMap = new Map(profiles?.map((p) => [p.id, p]) ?? []);

  const rows: AdminUserRow[] = authList.users.map((u) => {
    const p = profileMap.get(u.id);
    return {
      id: u.id,
      email: u.email ?? null,
      display_name: p?.display_name ?? null,
      is_admin: p?.is_admin ?? false,
      created_at: u.created_at,
    };
  });

  rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return ok(rows);
}

export async function setUserAdmin(
  input: unknown,
): Promise<ActionResult<{ user_id: string; is_admin: boolean }>> {
  const caller = await requireAdmin();
  const parsed = setAdminSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { user_id, is_admin } = parsed.data;

  // Prevent an admin from demoting themselves from the UI — avoid a lockout.
  if (user_id === caller.userId && !is_admin) {
    return fail("You can't demote yourself. Ask another admin to do it.");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ is_admin })
    .eq("id", user_id);

  if (error) return fail(error.message);

  revalidatePath("/admin/users");
  return ok({ user_id, is_admin });
}
