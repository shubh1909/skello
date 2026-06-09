"use server";

import { revalidatePath } from "next/cache";

import { logSkeloError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  addDialNumberSchema,
  removeDialNumberSchema,
  renameDialNumberSchema,
  voiceConfigGetSchema,
} from "@/lib/validations/voice-config";
import { type ActionResult, fail, ok } from "@/types/action";
import type {
  DialNumberEntry,
  VoiceAgentEntry,
  VoiceConfig,
} from "@/types/voice-config";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Post-remodel: agents live in `voice_agents` (PK agent_id, FK org).
// `bolna_integrations` keeps the default agent + the dialling-number list.
// The shape returned by getVoiceConfig() hasn't changed — we just source
// agents from the registry.
interface IntegrationRow {
  agent_id: string;
  from_phone_number: string | null;
  from_phone_numbers: string[];
  from_phone_labels: Record<string, unknown>;
  enabled: boolean;
  daily_calls_per_number: number | null;
}

// Fallback when a row predates the configurable cap column. Mirrors
// DEFAULT_DAILY_CALLS_PER_NUMBER in lib/campaigns/dispatch.ts.
const DEFAULT_DAILY_CALLS_PER_NUMBER = 200;

interface VoiceAgentRow {
  agent_id: string;
  label: string | null;
  enabled: boolean;
}

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

function labelFor(map: Record<string, unknown>, key: string, fallback: string) {
  const raw = map?.[key];
  return typeof raw === "string" && raw.trim().length > 0 ? raw : fallback;
}

function buildAgents(
  integration: IntegrationRow,
  registered: VoiceAgentRow[],
): VoiceAgentEntry[] {
  const seen = new Set<string>();
  const out: VoiceAgentEntry[] = [];

  // The integration's default agent always comes first and is flagged as
  // such. If for any reason it's not also in voice_agents (registry-out-of-
  // sync), we still surface it so the picker isn't empty.
  const defaultRow = registered.find((r) => r.agent_id === integration.agent_id);
  if (integration.agent_id) {
    seen.add(integration.agent_id);
    out.push({
      id: integration.agent_id,
      label: defaultRow?.label ?? "Default agent",
      is_default: true,
    });
  }

  for (const row of registered) {
    if (!row.enabled) continue;
    if (seen.has(row.agent_id)) continue;
    seen.add(row.agent_id);
    out.push({
      id: row.agent_id,
      label: row.label ?? row.agent_id,
      is_default: false,
    });
  }
  return out;
}

function buildDialNumbers(row: IntegrationRow): DialNumberEntry[] {
  const seen = new Set<string>();
  const out: DialNumberEntry[] = [];
  if (row.from_phone_number) {
    seen.add(row.from_phone_number);
    out.push({
      phone: row.from_phone_number,
      label: labelFor(
        row.from_phone_labels,
        row.from_phone_number,
        "Default number",
      ),
      is_default: true,
    });
  }
  for (const phone of row.from_phone_numbers ?? []) {
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    out.push({
      phone,
      label: labelFor(row.from_phone_labels, phone, phone),
      is_default: false,
    });
  }
  return out;
}

const INTEGRATION_COLUMNS =
  "agent_id, from_phone_number, from_phone_numbers, from_phone_labels, enabled, daily_calls_per_number";

async function loadIntegration(
  organisationId: string,
): Promise<IntegrationRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bolna_integrations")
    .select(INTEGRATION_COLUMNS)
    .eq("organisation_id", organisationId)
    .maybeSingle<IntegrationRow>();
  if (error) {
    logSkeloError("VOICE-AGENT-READ", "Integration lookup failed", {
      organisationId,
      cause: error,
    });
    return null;
  }
  return data;
}

async function loadVoiceAgents(organisationId: string): Promise<VoiceAgentRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("voice_agents")
    .select("agent_id, label, enabled")
    .eq("organisation_id", organisationId)
    .order("created_at", { ascending: true });
  if (error) {
    logSkeloError("VOICE-AGENT-READ", "Voice agents registry lookup failed", {
      organisationId,
      cause: error,
    });
    return [];
  }
  return (data ?? []) as VoiceAgentRow[];
}

export async function getVoiceConfig(
  input: unknown,
): Promise<ActionResult<VoiceConfig>> {
  const parsed = voiceConfigGetSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input");

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userOwnsOrg(supabase, user.id, parsed.data.organisation_id))) {
    return fail("Forbidden");
  }

  const [integration, registered] = await Promise.all([
    loadIntegration(parsed.data.organisation_id),
    loadVoiceAgents(parsed.data.organisation_id),
  ]);
  if (!integration) {
    return ok({
      enabled: false,
      agents: [],
      dial_numbers: [],
      daily_calls_per_number: DEFAULT_DAILY_CALLS_PER_NUMBER,
    });
  }
  return ok({
    enabled: integration.enabled,
    agents: buildAgents(integration, registered),
    dial_numbers: buildDialNumbers(integration),
    daily_calls_per_number:
      integration.daily_calls_per_number ?? DEFAULT_DAILY_CALLS_PER_NUMBER,
  });
}

export async function addDialNumber(
  input: unknown,
): Promise<ActionResult<VoiceConfig>> {
  const parsed = addDialNumberSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userOwnsOrg(supabase, user.id, parsed.data.organisation_id))) {
    return fail("Forbidden");
  }

  const integration = await loadIntegration(parsed.data.organisation_id);
  if (!integration) return fail("Voice agent not configured. Set it up in Settings.");

  if (integration.from_phone_number === parsed.data.phone) {
    if (parsed.data.label) {
      const labels = {
        ...integration.from_phone_labels,
        [integration.from_phone_number]: parsed.data.label,
      };
      const admin = createAdminClient();
      const { error } = await admin
        .from("bolna_integrations")
        .update({ from_phone_labels: labels })
        .eq("organisation_id", parsed.data.organisation_id);
      if (error) {
        return fail(
          logSkeloError("VOICE-AGENT-WRITE", "Updating dial number label failed", {
            organisationId: parsed.data.organisation_id,
            cause: error,
          }),
        );
      }
    }
    return getVoiceConfig({ organisation_id: parsed.data.organisation_id });
  }

  const existing = new Set(integration.from_phone_numbers ?? []);
  existing.add(parsed.data.phone);
  const labels = { ...integration.from_phone_labels };
  if (parsed.data.label) labels[parsed.data.phone] = parsed.data.label;

  const admin = createAdminClient();
  const { error } = await admin
    .from("bolna_integrations")
    .update({
      from_phone_numbers: Array.from(existing),
      from_phone_labels: labels,
    })
    .eq("organisation_id", parsed.data.organisation_id);
  if (error) {
    return fail(
      logSkeloError("VOICE-AGENT-WRITE", "Adding dial number failed", {
        organisationId: parsed.data.organisation_id,
        cause: error,
      }),
    );
  }

  revalidatePath("/campaigns");
  return getVoiceConfig({ organisation_id: parsed.data.organisation_id });
}

export async function renameDialNumber(
  input: unknown,
): Promise<ActionResult<VoiceConfig>> {
  const parsed = renameDialNumberSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input");

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userOwnsOrg(supabase, user.id, parsed.data.organisation_id))) {
    return fail("Forbidden");
  }

  const integration = await loadIntegration(parsed.data.organisation_id);
  if (!integration) return fail("Voice agent not configured");

  const present =
    parsed.data.phone === integration.from_phone_number ||
    (integration.from_phone_numbers ?? []).includes(parsed.data.phone);
  if (!present) return fail("Number not found");

  const labels = { ...integration.from_phone_labels };
  if (parsed.data.label) labels[parsed.data.phone] = parsed.data.label;
  else delete labels[parsed.data.phone];

  const admin = createAdminClient();
  const { error } = await admin
    .from("bolna_integrations")
    .update({ from_phone_labels: labels })
    .eq("organisation_id", parsed.data.organisation_id);
  if (error) {
    return fail(
      logSkeloError("VOICE-AGENT-WRITE", "Renaming dial number failed", {
        organisationId: parsed.data.organisation_id,
        cause: error,
      }),
    );
  }

  revalidatePath("/campaigns");
  return getVoiceConfig({ organisation_id: parsed.data.organisation_id });
}

export async function removeDialNumber(
  input: unknown,
): Promise<ActionResult<VoiceConfig>> {
  const parsed = removeDialNumberSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input");

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userOwnsOrg(supabase, user.id, parsed.data.organisation_id))) {
    return fail("Forbidden");
  }

  const integration = await loadIntegration(parsed.data.organisation_id);
  if (!integration) return fail("Voice agent not configured");
  if (parsed.data.phone === integration.from_phone_number) {
    return fail("Can't remove the default number. Update it in Settings.");
  }

  const next = (integration.from_phone_numbers ?? []).filter(
    (n) => n !== parsed.data.phone,
  );
  const labels = { ...integration.from_phone_labels };
  delete labels[parsed.data.phone];

  const admin = createAdminClient();
  const { error } = await admin
    .from("bolna_integrations")
    .update({ from_phone_numbers: next, from_phone_labels: labels })
    .eq("organisation_id", parsed.data.organisation_id);
  if (error) {
    return fail(
      logSkeloError("VOICE-AGENT-WRITE", "Removing dial number failed", {
        organisationId: parsed.data.organisation_id,
        cause: error,
      }),
    );
  }

  revalidatePath("/campaigns");
  return getVoiceConfig({ organisation_id: parsed.data.organisation_id });
}
