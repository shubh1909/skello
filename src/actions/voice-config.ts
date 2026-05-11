"use server";

import { revalidatePath } from "next/cache";

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

interface IntegrationRow {
  agent_id: string;
  agent_ids: string[];
  agent_labels: Record<string, unknown>;
  from_phone_number: string | null;
  from_phone_numbers: string[];
  from_phone_labels: Record<string, unknown>;
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

function buildAgents(row: IntegrationRow): VoiceAgentEntry[] {
  const seen = new Set<string>();
  const out: VoiceAgentEntry[] = [];
  if (row.agent_id) {
    seen.add(row.agent_id);
    out.push({
      id: row.agent_id,
      label: labelFor(row.agent_labels, row.agent_id, "Default agent"),
      is_default: true,
    });
  }
  for (const id of row.agent_ids ?? []) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: labelFor(row.agent_labels, id, id),
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
  "agent_id, agent_ids, agent_labels, from_phone_number, from_phone_numbers, from_phone_labels, enabled";

async function loadIntegration(
  organisationId: string,
): Promise<IntegrationRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("bolna_integrations")
    .select(INTEGRATION_COLUMNS)
    .eq("organisation_id", organisationId)
    .maybeSingle<IntegrationRow>();
  return data;
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

  const row = await loadIntegration(parsed.data.organisation_id);
  if (!row) {
    return ok({ enabled: false, agents: [], dial_numbers: [] });
  }
  return ok({
    enabled: row.enabled,
    agents: buildAgents(row),
    dial_numbers: buildDialNumbers(row),
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

  const row = await loadIntegration(parsed.data.organisation_id);
  if (!row) return fail("Voice agent not configured. Set it up in Settings.");

  if (row.from_phone_number === parsed.data.phone) {
    if (parsed.data.label) {
      const labels = {
        ...row.from_phone_labels,
        [row.from_phone_number]: parsed.data.label,
      };
      const admin = createAdminClient();
      const { error } = await admin
        .from("bolna_integrations")
        .update({ from_phone_labels: labels })
        .eq("organisation_id", parsed.data.organisation_id);
      if (error) return fail(error.message);
    }
    return getVoiceConfig({ organisation_id: parsed.data.organisation_id });
  }

  const existing = new Set(row.from_phone_numbers ?? []);
  existing.add(parsed.data.phone);
  const labels = { ...row.from_phone_labels };
  if (parsed.data.label) labels[parsed.data.phone] = parsed.data.label;

  const admin = createAdminClient();
  const { error } = await admin
    .from("bolna_integrations")
    .update({
      from_phone_numbers: Array.from(existing),
      from_phone_labels: labels,
    })
    .eq("organisation_id", parsed.data.organisation_id);
  if (error) return fail(error.message);

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

  const row = await loadIntegration(parsed.data.organisation_id);
  if (!row) return fail("Voice agent not configured");

  const present =
    parsed.data.phone === row.from_phone_number ||
    (row.from_phone_numbers ?? []).includes(parsed.data.phone);
  if (!present) return fail("Number not found");

  const labels = { ...row.from_phone_labels };
  if (parsed.data.label) labels[parsed.data.phone] = parsed.data.label;
  else delete labels[parsed.data.phone];

  const admin = createAdminClient();
  const { error } = await admin
    .from("bolna_integrations")
    .update({ from_phone_labels: labels })
    .eq("organisation_id", parsed.data.organisation_id);
  if (error) return fail(error.message);

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

  const row = await loadIntegration(parsed.data.organisation_id);
  if (!row) return fail("Voice agent not configured");
  if (parsed.data.phone === row.from_phone_number) {
    return fail("Can't remove the default number. Update it in Settings.");
  }

  const next = (row.from_phone_numbers ?? []).filter(
    (n) => n !== parsed.data.phone,
  );
  const labels = { ...row.from_phone_labels };
  delete labels[parsed.data.phone];

  const admin = createAdminClient();
  const { error } = await admin
    .from("bolna_integrations")
    .update({ from_phone_numbers: next, from_phone_labels: labels })
    .eq("organisation_id", parsed.data.organisation_id);
  if (error) return fail(error.message);

  revalidatePath("/campaigns");
  return getVoiceConfig({ organisation_id: parsed.data.organisation_id });
}
