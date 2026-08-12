import "server-only";

import { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * The session user, on a cookie-backed client.
 *
 * Returns `user: null` rather than redirecting — Server Actions answer with
 * `fail("Not authenticated")`, they don't navigate.
 */
export async function requireUser(): Promise<{
  supabase: SupabaseServerClient;
  user: { id: string; email?: string } | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user: user ? { id: user.id, email: user.email } : null };
}

/**
 * May this user administer this organisation?
 *
 * Two ways in: platform staff (`profiles.is_admin`), or the org's own owner.
 * There is no membership model in this codebase — tenancy is single-owner via
 * `organisations.owner_id` — so "org admin" and "org owner" are the same
 * person by construction.
 *
 * Lives here because it is a security boundary that was copy-pasted into
 * `actions/lead-field-definitions.ts` and `actions/voice-agents.ts`
 * independently. Two copies of an authorisation check is one copy away from
 * two behaviours.
 */
export async function userCanManageOrg(
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
