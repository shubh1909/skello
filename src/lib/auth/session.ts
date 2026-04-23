import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { Organisation } from "@/types/organisation";

export interface Session {
  userId: string;
  email: string;
  organisation: Organisation;
}

export async function requireSession(): Promise<Session> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: org } = await supabase
    .from("organisations")
    .select("id, name, slug, owner_id, created_at, updated_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<Organisation>();

  if (!org) redirect("/onboarding");

  return {
    userId: user.id,
    email: user.email ?? "",
    organisation: org,
  };
}
