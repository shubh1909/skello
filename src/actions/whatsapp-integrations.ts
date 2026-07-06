"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fail, ok } from "@/types/action";
import type { WhatsAppIntegration } from "@/types/whatsapp-integration";

// Owner-facing read only. All WhatsApp config (connect/edit/disconnect) lives in
// the admin console — see src/actions/admin/whatsapp.ts. The owner Settings page
// shows a read-only status card fed by getWhatsAppIntegration below.

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

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

export async function getWhatsAppIntegration(
  organisationId: unknown,
): Promise<ActionResult<WhatsAppIntegration | null>> {
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
    .from("whatsapp_integrations")
    .select(INTEGRATION_COLUMNS)
    .eq("organisation_id", organisationId)
    .maybeSingle<IntegrationRow>();

  if (error) return fail(error.message);
  return ok(data ? toPublic(data) : null);
}
