"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth/admin";
import { recoveryTemplateVariableOrder } from "@/lib/shopify/recovery-templates";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  whatsappIntegrationUpdateSchema,
  whatsappIntegrationUpsertSchema,
} from "@/lib/validations/whatsapp-integration";
import { getWhatsAppProvider } from "@/lib/whatsapp/registry";
import { WhatsAppSendError } from "@/lib/whatsapp/provider";
import { type ActionResult, fail, ok } from "@/types/action";
import type { WhatsAppIntegration } from "@/types/whatsapp-integration";

interface IntegrationRow {
  organisation_id: string;
  provider: string;
  api_token: string;
  base_url: string | null;
  sender_id: string | null;
  template_name: string | null;
  template_language: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

const INTEGRATION_COLUMNS =
  "organisation_id, provider, api_token, base_url, sender_id, template_name, template_language, enabled, created_at, updated_at";

function toPublic(row: IntegrationRow): WhatsAppIntegration {
  return {
    organisation_id: row.organisation_id,
    provider: row.provider,
    base_url: row.base_url,
    sender_id: row.sender_id,
    template_name: row.template_name,
    template_language: row.template_language,
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
      template_language: parsed.data.template_language,
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

// Non-empty sample values for every recovery variable the template adapter may
// read — across BOTH layouts (classic and coupon_link). All fields are populated
// so a test send exercises the real template (name + language + parameter count)
// without tripping Meta's empty-param 400 — a rejection here therefore points at
// a genuine template mismatch. Keys must stay in sync with
// buildRecoveryVariables (lib/shopify/recovery.ts); a key missing here is sent
// as "-" and silently degrades the test into a false pass.
const TEST_VARIABLES: Record<string, string> = {
  customer_name: "Test Customer",
  top_product: "Sample Product",
  cart_summary: "Sample Product",
  item_count: "1",
  currency: "INR",
  cart_total: "4999",
  discount_name: "Test Offer",
  discount_code: "TEST10",
  discount_percentage: "10%",
  discount_amount: "500",
  discounted_cart_total: "4499",
  recovery_url: "https://example.com/cart",
  store_name: "example.com",
  discount_link: "https://example.com/discount/TEST10?redirect=/cart",
};

const testSendSchema = z.object({
  organisation_id: z.string().uuid(),
  to_phone: z.string().trim().min(5).max(20),
});

interface TestSendRow {
  provider: string;
  api_token: string;
  base_url: string | null;
  sender_id: string | null;
  template_name: string | null;
  template_language: string;
}

// The recovery settings that decide WHICH template the dispatcher sends and with
// WHICH parameter order. A test that ignores these tests a different message
// than production sends.
interface TestSendSettingsRow {
  whatsapp_template_name: string | null;
  whatsapp_template_layout: string | null;
}

// Fire one real template send to a chosen number so an admin can validate a
// WhatsApp connection (token, template name, language, parameter count) before
// it goes live — and see the provider's exact error if it's misconfigured.
export async function sendTestWhatsAppAdmin(
  input: unknown,
): Promise<ActionResult<{ providerMessageId: string }>> {
  await requireAdmin();
  const parsed = testSendSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("whatsapp_integrations")
    .select(
      "provider, api_token, base_url, sender_id, template_name, template_language",
    )
    .eq("organisation_id", parsed.data.organisation_id)
    .maybeSingle<TestSendRow>();

  if (error) return fail(error.message);
  if (!row) return fail("WhatsApp isn't connected for this workspace yet.");

  const { data: settings } = await admin
    .from("shopify_recovery_settings")
    .select("whatsapp_template_name, whatsapp_template_layout")
    .eq("organisation_id", parsed.data.organisation_id)
    .maybeSingle<TestSendSettingsRow>();

  // Mirror the dispatcher's precedence (lib/shopify/whatsapp-recovery.ts): the
  // recovery settings' template wins over the integration-level default, so the
  // test exercises the template production will actually send.
  const templateName =
    settings?.whatsapp_template_name?.trim() ||
    row.template_name?.trim() ||
    null;
  if (!templateName) {
    return fail("Set an approved template name before sending a test.");
  }

  try {
    const provider = getWhatsAppProvider(row.provider);
    const result = await provider.sendTemplate({
      apiToken: row.api_token,
      baseUrl: row.base_url,
      senderId: row.sender_id,
      templateName,
      language: row.template_language,
      toPhone: parsed.data.to_phone,
      variables: TEST_VARIABLES,
      // Match the org's layout. Without this the adapter falls back to the
      // classic 6-param order, so a coupon_link org (the default) gets a
      // param-count 400 on a config that works fine in production.
      variableOrder: recoveryTemplateVariableOrder(
        settings?.whatsapp_template_layout,
      ),
    });
    return ok({ providerMessageId: result.providerMessageId });
  } catch (err) {
    if (err instanceof WhatsAppSendError) {
      return fail(`Send rejected (${err.status}): ${err.message}`);
    }
    return fail("Failed to reach the WhatsApp provider.");
  }
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
