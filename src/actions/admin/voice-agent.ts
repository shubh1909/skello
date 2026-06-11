"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { pingBolna } from "@/lib/bolna/client";
import { requireAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionResult, fail, ok } from "@/types/action";
import type { BolnaIntegration } from "@/types/bolna-integration";

interface IntegrationRow {
  organisation_id: string;
  agent_id: string;
  api_key: string;
  from_phone_number: string | null;
  enabled: boolean;
  daily_calls_per_number: number | null;
  created_at: string;
  updated_at: string;
}

const DEFAULT_DAILY_CALLS_PER_NUMBER = 200;

const INTEGRATION_COLUMNS =
  "organisation_id, agent_id, api_key, from_phone_number, enabled, daily_calls_per_number, created_at, updated_at";

function toPublic(row: IntegrationRow): BolnaIntegration {
  return {
    organisation_id: row.organisation_id,
    agent_id: row.agent_id,
    from_phone_number: row.from_phone_number,
    enabled: row.enabled,
    daily_calls_per_number:
      row.daily_calls_per_number ?? DEFAULT_DAILY_CALLS_PER_NUMBER,
    created_at: row.created_at,
    updated_at: row.updated_at,
    api_key_last4: row.api_key.slice(-4),
  };
}

const fromPhone = z
  .string()
  .trim()
  .min(5)
  .max(32)
  .nullish()
  .transform((v) => (v && v.length > 0 ? v : null));

const upsertSchema = z.object({
  organisation_id: z.string().uuid(),
  agent_id: z.string().trim().min(1).max(200),
  api_key: z.string().trim().min(1).max(500),
  from_phone_number: fromPhone,
  enabled: z.boolean().default(true),
});

const updateSchema = z.object({
  organisation_id: z.string().uuid(),
  agent_id: z.string().trim().min(1).max(200).optional(),
  api_key: z.string().trim().min(1).max(500).optional(),
  from_phone_number: fromPhone.optional(),
  enabled: z.boolean().optional(),
});

export async function getVoiceAgentAdmin(
  organisationId: unknown,
): Promise<ActionResult<BolnaIntegration | null>> {
  await requireAdmin();
  if (typeof organisationId !== "string") {
    return fail("Invalid organisation id");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bolna_integrations")
    .select(INTEGRATION_COLUMNS)
    .eq("organisation_id", organisationId)
    .maybeSingle<IntegrationRow>();

  if (error) return fail(error.message);
  return ok(data ? toPublic(data) : null);
}

export async function upsertVoiceAgentAdmin(
  input: unknown,
): Promise<ActionResult<BolnaIntegration>> {
  await requireAdmin();
  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bolna_integrations")
    .upsert({
      organisation_id: parsed.data.organisation_id,
      agent_id: parsed.data.agent_id,
      api_key: parsed.data.api_key,
      from_phone_number: parsed.data.from_phone_number,
      enabled: parsed.data.enabled,
    })
    .select(INTEGRATION_COLUMNS)
    .single<IntegrationRow>();

  if (error) return fail(error.message);

  revalidatePath("/admin/organisations");
  revalidatePath(`/admin/organisations/${parsed.data.organisation_id}`);
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath("/pulse");
  return ok(toPublic(data));
}

export async function updateVoiceAgentAdmin(
  input: unknown,
): Promise<ActionResult<BolnaIntegration>> {
  await requireAdmin();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { organisation_id, ...patch } = parsed.data;
  if (Object.keys(patch).length === 0) return fail("No fields to update");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bolna_integrations")
    .update(patch)
    .eq("organisation_id", organisation_id)
    .select(INTEGRATION_COLUMNS)
    .single<IntegrationRow>();

  if (error) return fail(error.message);

  revalidatePath("/admin/organisations");
  revalidatePath(`/admin/organisations/${organisation_id}`);
  revalidatePath("/settings");
  return ok(toPublic(data));
}

export interface VoiceAgentTestResult {
  status: number;
  agent_id: string;
  api_key_last4: string;
  message: string;
}

export async function testVoiceAgentAdmin(
  organisationId: unknown,
): Promise<ActionResult<VoiceAgentTestResult>> {
  await requireAdmin();
  if (typeof organisationId !== "string") {
    return fail("Invalid organisation id");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bolna_integrations")
    .select("agent_id, api_key")
    .eq("organisation_id", organisationId)
    .maybeSingle<{ agent_id: string; api_key: string }>();

  if (error) return fail(error.message);
  if (!data) return fail("Voice agent is not configured for this workspace.");

  let result;
  try {
    result = await pingBolna({
      apiKey: data.api_key,
      agentId: data.agent_id,
    });
  } catch (err) {
    console.error("[admin/voice-agent] ping network error", err);
    return fail(
      err instanceof Error
        ? `Network error: ${err.message}`
        : "Network error reaching the voice provider",
    );
  }

  const last4 = data.api_key.slice(-4);
  console.info(
    `[admin/voice-agent] ping org=${organisationId} status=${result.status}`,
  );

  if (result.ok) {
    return ok({
      status: result.status,
      agent_id: data.agent_id,
      api_key_last4: last4,
      message:
        "Connection successful — the voice provider accepted the API key and recognised the agent.",
    });
  }

  // Surface the provider's body verbatim so the operator can act on it.
  const detail = result.body || `HTTP ${result.status}`;
  return fail(`Voice provider returned ${result.status}: ${detail}`);
}

export async function disconnectVoiceAgentAdmin(
  organisationId: unknown,
): Promise<ActionResult<{ organisation_id: string }>> {
  await requireAdmin();
  if (typeof organisationId !== "string") {
    return fail("Invalid organisation id");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("bolna_integrations")
    .delete()
    .eq("organisation_id", organisationId);

  if (error) return fail(error.message);

  revalidatePath("/admin/organisations");
  revalidatePath(`/admin/organisations/${organisationId}`);
  revalidatePath("/settings");
  return ok({ organisation_id: organisationId });
}
