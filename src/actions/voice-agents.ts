"use server";

import { revalidatePath } from "next/cache";

import { pingBolna } from "@/lib/bolna/client";
import { logSkeloError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  registerVoiceAgentSchema,
  removeVoiceAgentSchema,
  updateVoiceAgentSchema,
} from "@/lib/validations/voice-agent";
import { type ActionResult, fail, ok } from "@/types/action";
import type { VoiceAgent } from "@/types/voice-agent";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const COLUMNS =
  "agent_id, organisation_id, label, enabled, verified_at, created_at, updated_at";

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

export async function listVoiceAgents(
  organisationId: unknown,
): Promise<ActionResult<VoiceAgent[]>> {
  if (typeof organisationId !== "string") return fail("Invalid organisation id");

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userCanManageOrg(supabase, user.id, organisationId))) {
    return fail("Forbidden");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("voice_agents")
    .select(COLUMNS)
    .eq("organisation_id", organisationId)
    .order("created_at", { ascending: true });

  if (error) return fail(error.message);
  return ok((data ?? []) as VoiceAgent[]);
}

// Verifies the agent_id against the provider's API using the org's stored
// API key, then claims it. The PRIMARY KEY on voice_agents.agent_id is what
// stops two orgs from claiming the same id — we surface that as a clean
// "already linked elsewhere" error rather than the raw Postgres message.
export async function registerVoiceAgent(
  input: unknown,
): Promise<ActionResult<VoiceAgent>> {
  const parsed = registerVoiceAgentSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userCanManageOrg(supabase, user.id, parsed.data.organisation_id))) {
    return fail("Forbidden");
  }

  const admin = createAdminClient();
  const { data: integration } = await admin
    .from("bolna_integrations")
    .select("api_key")
    .eq("organisation_id", parsed.data.organisation_id)
    .maybeSingle<{ api_key: string }>();

  if (!integration?.api_key) {
    return fail(
      "Connect the voice provider first (Voice agent card on this page) before adding agents.",
    );
  }

  // Ownership verification: ping the provider with the org's key + the
  // claimed agent_id. A 200 means the key has access to that agent.
  let pingResult;
  try {
    pingResult = await pingBolna({
      apiKey: integration.api_key,
      agentId: parsed.data.agent_id,
    });
  } catch (err) {
    return fail(
      logSkeloError("VOICE-AGENT-VERIFY", "Network error reaching voice provider", {
        organisationId: parsed.data.organisation_id,
        agentId: parsed.data.agent_id,
        cause: err,
      }),
    );
  }
  if (!pingResult.ok) {
    return fail(
      logSkeloError("VOICE-AGENT-VERIFY", `Voice provider rejected this agent id (HTTP ${pingResult.status}). Confirm the id and try again.`, {
        organisationId: parsed.data.organisation_id,
        agentId: parsed.data.agent_id,
        cause: pingResult.body,
      }),
    );
  }

  const { data, error } = await admin
    .from("voice_agents")
    .insert({
      agent_id: parsed.data.agent_id,
      organisation_id: parsed.data.organisation_id,
      label: parsed.data.label,
      verified_at: new Date().toISOString(),
    })
    .select(COLUMNS)
    .single<VoiceAgent>();

  if (error) {
    if (error.code === "23505") {
      return fail(
        "This agent is already linked to another workspace. Contact support if you believe this is a mistake.",
      );
    }
    return fail(
      logSkeloError("VOICE-AGENT-WRITE", "Could not register voice agent", {
        organisationId: parsed.data.organisation_id,
        agentId: parsed.data.agent_id,
        cause: error,
      }),
    );
  }

  revalidatePath("/settings");
  revalidatePath(`/admin/organisations/${parsed.data.organisation_id}`);
  revalidatePath(
    `/admin/organisations/${parsed.data.organisation_id}/voice-agents`,
  );
  return ok(data);
}

export async function updateVoiceAgent(
  input: unknown,
): Promise<ActionResult<VoiceAgent>> {
  const parsed = updateVoiceAgentSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userCanManageOrg(supabase, user.id, parsed.data.organisation_id))) {
    return fail("Forbidden");
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.label !== undefined) patch.label = parsed.data.label;
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
  if (Object.keys(patch).length === 0) return fail("No fields to update");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("voice_agents")
    .update(patch)
    .eq("agent_id", parsed.data.agent_id)
    .eq("organisation_id", parsed.data.organisation_id)
    .select(COLUMNS)
    .single<VoiceAgent>();

  if (error) return fail(error.message);
  revalidatePath(
    `/admin/organisations/${parsed.data.organisation_id}/voice-agents`,
  );
  return ok(data);
}

export async function removeVoiceAgent(
  input: unknown,
): Promise<ActionResult<{ agent_id: string }>> {
  const parsed = removeVoiceAgentSchema.safeParse(input);
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
    .from("voice_agents")
    .delete()
    .eq("agent_id", parsed.data.agent_id)
    .eq("organisation_id", parsed.data.organisation_id);

  if (error) return fail(error.message);
  revalidatePath(
    `/admin/organisations/${parsed.data.organisation_id}/voice-agents`,
  );
  return ok({ agent_id: parsed.data.agent_id });
}
