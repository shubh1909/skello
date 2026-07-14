"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  bolnaIntegrationUpdateSchema,
  bolnaIntegrationUpsertSchema,
} from "@/lib/validations/bolna-integration";
import { type ActionResult, fail, ok } from "@/types/action";
import type { BolnaIntegration } from "@/types/bolna-integration";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

interface IntegrationRow {
  organisation_id: string;
  agent_id: string;
  api_key: string;
  from_phone_number: string | null;
  enabled: boolean;
  daily_calls_per_number: number | null;
  max_connected_calls_per_lead: number | null;
  callbacks_enabled: boolean;
  callback_agent_id: string | null;
  callback_from_phone: string | null;
  created_at: string;
  updated_at: string;
}

const DEFAULT_DAILY_CALLS_PER_NUMBER = 200;

const INTEGRATION_COLUMNS =
  "organisation_id, agent_id, api_key, from_phone_number, enabled, daily_calls_per_number, max_connected_calls_per_lead, callbacks_enabled, callback_agent_id, callback_from_phone, created_at, updated_at";

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

function toPublic(row: IntegrationRow): BolnaIntegration {
  return {
    organisation_id: row.organisation_id,
    agent_id: row.agent_id,
    from_phone_number: row.from_phone_number,
    enabled: row.enabled,
    daily_calls_per_number:
      row.daily_calls_per_number ?? DEFAULT_DAILY_CALLS_PER_NUMBER,
    // null is meaningful here (unlimited) — pass through, don't default.
    max_connected_calls_per_lead: row.max_connected_calls_per_lead,
    callbacks_enabled: row.callbacks_enabled,
    callback_agent_id: row.callback_agent_id,
    callback_from_phone: row.callback_from_phone,
    created_at: row.created_at,
    updated_at: row.updated_at,
    api_key_last4: row.api_key.slice(-4),
  };
}

export async function getBolnaIntegration(
  organisationId: unknown,
): Promise<ActionResult<BolnaIntegration | null>> {
  if (typeof organisationId !== "string") {
    return fail("Invalid organisation id");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userOwnsOrg(supabase, user.id, organisationId))) {
    return fail("Forbidden");
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

export async function upsertBolnaIntegration(
  input: unknown,
): Promise<ActionResult<BolnaIntegration>> {
  const parsed = bolnaIntegrationUpsertSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userOwnsOrg(supabase, user.id, parsed.data.organisation_id))) {
    return fail("Forbidden");
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

  revalidatePath("/settings");
  return ok(toPublic(data));
}

export async function updateBolnaIntegration(
  input: unknown,
): Promise<ActionResult<BolnaIntegration>> {
  const parsed = bolnaIntegrationUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { organisation_id, ...patch } = parsed.data;
  if (Object.keys(patch).length === 0) return fail("No fields to update");

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userOwnsOrg(supabase, user.id, organisation_id))) {
    return fail("Forbidden");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bolna_integrations")
    .update(patch)
    .eq("organisation_id", organisation_id)
    .select(INTEGRATION_COLUMNS)
    .single<IntegrationRow>();

  if (error) return fail(error.message);

  revalidatePath("/settings");
  return ok(toPublic(data));
}

export async function deleteBolnaIntegration(
  organisationId: unknown,
): Promise<ActionResult<{ organisation_id: string }>> {
  if (typeof organisationId !== "string") {
    return fail("Invalid organisation id");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userOwnsOrg(supabase, user.id, organisationId))) {
    return fail("Forbidden");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("bolna_integrations")
    .delete()
    .eq("organisation_id", organisationId);

  if (error) return fail(error.message);

  revalidatePath("/settings");
  return ok({ organisation_id: organisationId });
}
