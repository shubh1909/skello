"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  whatsappIntegrationUpdateSchema,
  whatsappIntegrationUpsertSchema,
} from "@/lib/validations/whatsapp-integration";
import { type ActionResult, fail, ok } from "@/types/action";
import type { WhatsAppIntegration } from "@/types/whatsapp-integration";

interface IntegrationRow {
  organisation_id: string;
  provider: string;
  api_token: string;
  base_url: string | null;
  sender_id: string | null;
  template_name: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

const INTEGRATION_COLUMNS =
  "organisation_id, provider, api_token, base_url, sender_id, template_name, enabled, created_at, updated_at";

function toPublic(row: IntegrationRow): WhatsAppIntegration {
  return {
    organisation_id: row.organisation_id,
    provider: row.provider,
    base_url: row.base_url,
    sender_id: row.sender_id,
    template_name: row.template_name,
    enabled: row.enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
    api_token_last4: row.api_token.slice(-4),
  };
}

function revalidate(organisationId: string) {
  revalidatePath("/admin/organisations");
  revalidatePath(`/admin/organisations/${organisationId}`);
  revalidatePath("/settings");
  revalidatePath("/campaigns/templates/cart-recovery");
}

export async function getWhatsAppAdmin(
  organisationId: unknown,
): Promise<ActionResult<WhatsAppIntegration | null>> {
  await requireAdmin();
  if (typeof organisationId !== "string") {
    return fail("Invalid organisation id");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("whatsapp_integrations")
    .select(INTEGRATION_COLUMNS)
    .eq("organisation_id", organisationId)
    .maybeSingle<IntegrationRow>();

  if (error) return fail(error.message);
  return ok(data ? toPublic(data) : null);
}

export async function upsertWhatsAppAdmin(
  input: unknown,
): Promise<ActionResult<WhatsAppIntegration>> {
  await requireAdmin();
  const parsed = whatsappIntegrationUpsertSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("whatsapp_integrations")
    .upsert({
      organisation_id: parsed.data.organisation_id,
      provider: parsed.data.provider,
      api_token: parsed.data.api_token,
      base_url: parsed.data.base_url,
      sender_id: parsed.data.sender_id,
      template_name: parsed.data.template_name,
      enabled: parsed.data.enabled,
    })
    .select(INTEGRATION_COLUMNS)
    .single<IntegrationRow>();

  if (error) return fail(error.message);

  revalidate(parsed.data.organisation_id);
  return ok(toPublic(data));
}

export async function updateWhatsAppAdmin(
  input: unknown,
): Promise<ActionResult<WhatsAppIntegration>> {
  await requireAdmin();
  const parsed = whatsappIntegrationUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { organisation_id, ...patch } = parsed.data;
  // Drop undefined fields so a blank token (omitted) keeps the existing one.
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  );
  if (Object.keys(clean).length === 0) return fail("No fields to update");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("whatsapp_integrations")
    .update(clean)
    .eq("organisation_id", organisation_id)
    .select(INTEGRATION_COLUMNS)
    .single<IntegrationRow>();

  if (error) return fail(error.message);

  revalidate(organisation_id);
  return ok(toPublic(data));
}

export async function disconnectWhatsAppAdmin(
  organisationId: unknown,
): Promise<ActionResult<{ organisation_id: string }>> {
  await requireAdmin();
  if (typeof organisationId !== "string") {
    return fail("Invalid organisation id");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("whatsapp_integrations")
    .delete()
    .eq("organisation_id", organisationId);

  if (error) return fail(error.message);

  revalidate(organisationId);
  return ok({ organisation_id: organisationId });
}
