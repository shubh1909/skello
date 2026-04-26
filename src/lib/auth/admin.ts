import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export interface AdminSession {
  userId: string;
  email: string;
}

/**
 * Gate for any page under `(admin)/`. Unlike `requireSession()`, this does
 * NOT require the user to belong to an organisation — Skello staff don't
 * have their own workspace.
 *
 *   - no user          → /login
 *   - user not admin   → /dashboard (no 403, no enumeration signal)
 *   - user is admin    → returns { userId, email }
 */
export async function requireAdmin(): Promise<AdminSession> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle<{ is_admin: boolean }>();

  if (!profile?.is_admin) redirect("/dashboard");

  return { userId: user.id, email: user.email ?? "" };
}

/**
 * Non-redirecting read. Use in Server Components that need to branch on
 * admin status (e.g., conditionally render the "Admin" link in UserMenu)
 * but still want to render the page for non-admins.
 */
export async function getIsAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle<{ is_admin: boolean }>();
  return Boolean(data?.is_admin);
}
