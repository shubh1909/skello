"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { BolnaApiError, initiateBolnaCall } from "@/lib/bolna/client";
import { requireSession } from "@/lib/auth/session";
import { logSkeloError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionResult, fail, ok } from "@/types/action";
import type {
  CodConfirmationRow,
  CodMetrics,
  CodOverview,
  CodPage,
  CodSettings,
  CodVoiceAgent,
} from "@/types/cod";

const SETTINGS_COLUMNS =
  "organisation_id, enabled, wait_minutes, max_attempts, retry_interval_seconds, agent_id, call_window_start, call_window_end, cod_gateway_names, created_at, updated_at";

const ROW_COLUMNS =
  "id, order_name, order_total, currency, phone, customer_name, gateway, status, confirmed, skip_reason, attempt, max_attempts, last_status, connected_at, next_attempt_at, created_at";

const PAGE_SIZE = 20;

// Dashboard read — settings + headline metrics + the voice-agent card. Org
// resolved from the session, never the client.
export async function getCodOverview(): Promise<ActionResult<CodOverview>> {
  const session = await requireSession();
  const orgId = session.organisation.id;
  const admin = createAdminClient();

  const [
    integrationRes,
    settingsRes,
    bolnaRes,
    ordersRes,
    callsMadeRes,
    confirmedRes,
    declinedRes,
    notReachedRes,
    currencyRes,
  ] = await Promise.all([
    admin
      .from("shopify_integrations")
      .select("access_token, enabled")
      .eq("organisation_id", orgId)
      .maybeSingle<{ access_token: string | null; enabled: boolean }>(),
    admin
      .from("shopify_cod_settings")
      .select(SETTINGS_COLUMNS)
      .eq("organisation_id", orgId)
      .maybeSingle<CodSettings>(),
    admin
      .from("bolna_integrations")
      .select("agent_id, from_phone_number, from_phone_numbers, enabled")
      .eq("organisation_id", orgId)
      .maybeSingle<{
        agent_id: string | null;
        from_phone_number: string | null;
        from_phone_numbers: string[] | null;
        enabled: boolean;
      }>(),
    // Actionable orders we recorded (everything that wasn't skipped).
    admin
      .from("shopify_cod_confirmations")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", orgId)
      .neq("status", "skipped"),
    admin
      .from("shopify_cod_confirmations")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", orgId)
      .gt("attempt", 0),
    admin
      .from("shopify_cod_confirmations")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", orgId)
      .eq("confirmed", true),
    admin
      .from("shopify_cod_confirmations")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", orgId)
      .eq("confirmed", false),
    admin
      .from("shopify_cod_confirmations")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", orgId)
      .eq("status", "failed"),
    admin
      .from("shopify_cod_confirmations")
      .select("currency")
      .eq("organisation_id", orgId)
      .not("currency", "is", null)
      .limit(1)
      .maybeSingle<{ currency: string | null }>(),
  ]);

  // Resolve the effective COD agent: the section override, else the org default.
  const bolna = bolnaRes.data;
  const effectiveAgentId =
    settingsRes.data?.agent_id?.trim() || bolna?.agent_id?.trim() || null;
  let agentName: string | null = null;
  if (effectiveAgentId) {
    const { data: agentRow } = await admin
      .from("voice_agents")
      .select("label")
      .eq("agent_id", effectiveAgentId)
      .maybeSingle<{ label: string | null }>();
    agentName = agentRow?.label ?? null;
  }
  let callerNumber =
    bolna?.from_phone_number?.trim() || bolna?.from_phone_numbers?.[0] || null;
  if (!callerNumber) {
    const { data: lastCall } = await admin
      .from("calls")
      .select("from_phone")
      .eq("organisation_id", orgId)
      .not("cod_confirmation_id", "is", null)
      .not("from_phone", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ from_phone: string | null }>();
    callerNumber = lastCall?.from_phone ?? null;
  }
  const voiceAgent: CodVoiceAgent = {
    name: agentName,
    callerNumber,
    configured: Boolean(effectiveAgentId && bolna?.enabled),
  };

  const metrics: CodMetrics = {
    orders: ordersRes.count ?? 0,
    calls_made: callsMadeRes.count ?? 0,
    confirmed: confirmedRes.count ?? 0,
    declined: declinedRes.count ?? 0,
    not_reached: notReachedRes.count ?? 0,
    currency: currencyRes.data?.currency ?? null,
  };

  return ok({
    connected: Boolean(
      integrationRes.data?.access_token && integrationRes.data?.enabled,
    ),
    settings: settingsRes.data ?? null,
    metrics,
    voiceAgent,
  });
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  wait_minutes: z.number().int().min(1).max(1440),
  max_attempts: z.number().int().min(1).max(10),
  retry_interval_seconds: z.number().int().min(60).max(86400),
  call_window_start: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM")
    .nullable()
    .optional(),
  call_window_end: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM")
    .nullable()
    .optional(),
  // Free-text list of gateway labels to treat as COD. Empty → built-in heuristic.
  cod_gateway_names: z.array(z.string().trim().max(120)).max(50).optional(),
});

// The org tunes its own timing + detection. Org resolved from the session; the
// service-role client performs the write (owner-read RLS, no owner-write policy).
export async function saveCodSettings(
  input: unknown,
): Promise<ActionResult<CodSettings>> {
  const session = await requireSession();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("shopify_cod_settings")
    .upsert(
      {
        organisation_id: session.organisation.id,
        enabled: parsed.data.enabled,
        wait_minutes: parsed.data.wait_minutes,
        max_attempts: parsed.data.max_attempts,
        retry_interval_seconds: parsed.data.retry_interval_seconds,
        // Window is both-or-neither: a partial range means "no restriction".
        call_window_start:
          parsed.data.call_window_start && parsed.data.call_window_end
            ? parsed.data.call_window_start
            : null,
        call_window_end:
          parsed.data.call_window_start && parsed.data.call_window_end
            ? parsed.data.call_window_end
            : null,
        ...(parsed.data.cod_gateway_names !== undefined
          ? {
              cod_gateway_names: parsed.data.cod_gateway_names
                .map((s) => s.trim())
                .filter((s) => s !== ""),
            }
          : {}),
      },
      { onConflict: "organisation_id" },
    )
    .select(SETTINGS_COLUMNS)
    .single<CodSettings>();

  if (error) {
    return fail(
      logSkeloError("SHOPIFY", "Failed to save COD settings", {
        organisationId: session.organisation.id,
        cause: error,
      }),
    );
  }

  revalidatePath("/campaigns/templates/cod-confirmation");
  return ok(data);
}

// Start / stop the always-on COD confirmation engine. Stopping also cancels
// queued (pending) rows so nothing further dials; in-flight calls finish.
export async function setCodRunning(
  running: unknown,
): Promise<ActionResult<{ running: boolean }>> {
  const session = await requireSession();
  const parsed = z.boolean().safeParse(running);
  if (!parsed.success) return fail("Invalid request");

  const orgId = session.organisation.id;
  const admin = createAdminClient();

  const { error } = await admin
    .from("shopify_cod_settings")
    .upsert(
      { organisation_id: orgId, enabled: parsed.data },
      { onConflict: "organisation_id" },
    );
  if (error) {
    return fail(
      logSkeloError("SHOPIFY", "Failed to toggle COD confirmation", {
        organisationId: orgId,
        cause: error,
      }),
    );
  }

  if (!parsed.data) {
    await admin
      .from("shopify_cod_confirmations")
      .update({ status: "canceled", canceled_at: new Date().toISOString() })
      .eq("organisation_id", orgId)
      .eq("status", "pending");
  }

  revalidatePath("/campaigns/templates/cod-confirmation");
  return ok({ running: parsed.data });
}

// E.164 — a real phone that will receive the demo call.
const E164 = /^\+[1-9]\d{6,14}$/;

const testSchema = z.object({
  to_phone: z.string().trim().regex(E164, "Use E.164, e.g. +14155551234"),
  // Dummy context — sent as the same {placeholders} the agent script reads.
  customer_name: z.string().trim().max(120).optional().default(""),
  order_name: z.string().trim().max(60).optional().default(""),
  order_total: z.string().trim().max(20).optional().default(""),
  currency: z.string().trim().max(10).optional().default(""),
});

/**
 * Place a one-off COD-confirmation call to a real phone with dummy context so
 * the owner can hear the agent's flow before going live. Org resolved from the
 * session; the effective agent is the COD override (set by admin), else the
 * org's default agent — exactly what a real confirmation call would use. The
 * dial is flagged is_test so it never touches a lead, a confirmation row, or
 * lifetime stats.
 */
export async function testCodAgentCall(
  input: unknown,
): Promise<ActionResult<{ dialed: string }>> {
  const session = await requireSession();
  const parsed = testSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const orgId = session.organisation.id;
  const admin = createAdminClient();

  const [{ data: bolna }, { data: settings }] = await Promise.all([
    admin
      .from("bolna_integrations")
      .select("api_key, from_phone_number, agent_id, enabled")
      .eq("organisation_id", orgId)
      .maybeSingle<{
        api_key: string;
        from_phone_number: string | null;
        agent_id: string | null;
        enabled: boolean;
      }>(),
    admin
      .from("shopify_cod_settings")
      .select("agent_id")
      .eq("organisation_id", orgId)
      .maybeSingle<{ agent_id: string | null }>(),
  ]);

  if (!bolna || !bolna.enabled) {
    return fail("The voice agent isn't connected for this workspace yet.");
  }
  const agentId = settings?.agent_id?.trim() || bolna.agent_id;
  if (!agentId) {
    return fail("No voice agent is configured for COD confirmation yet.");
  }

  const firstName = parsed.data.customer_name.split(/\s+/)[0] ?? "";
  const metadata = {
    customer_name: firstName,
    order_name: parsed.data.order_name,
    order_total: parsed.data.order_total,
    currency: parsed.data.currency,
    organisation_id: orgId,
    is_test: true,
  };

  try {
    const result = await initiateBolnaCall({
      apiKey: bolna.api_key,
      agentId,
      recipientPhone: parsed.data.to_phone,
      fromPhone: bolna.from_phone_number,
      metadata,
    });
    await admin.from("calls").insert({
      organisation_id: orgId,
      bolna_call_id: result.bolnaCallId,
      direction: "outbound",
      to_phone: parsed.data.to_phone,
      from_phone: bolna.from_phone_number,
      agent_id: agentId,
      status: "initiated",
      is_test: true,
    });
    return ok({ dialed: parsed.data.to_phone });
  } catch (err) {
    const reason =
      err instanceof BolnaApiError
        ? err.message
        : "Failed to reach the voice provider";
    await admin.from("calls").insert({
      organisation_id: orgId,
      to_phone: parsed.data.to_phone,
      from_phone: bolna.from_phone_number,
      agent_id: agentId,
      status: "failed",
      direction: "outbound",
      is_test: true,
      error_message: reason.slice(0, 500),
    });
    return fail(reason);
  }
}

const pageInput = z.object({
  page: z.number().int().min(0).max(100000).optional(),
});

// The confirmations activity table — every recorded COD order for this org,
// newest first, with its dial status + disposition.
export async function getCodConfirmations(
  input: unknown,
): Promise<ActionResult<CodPage<CodConfirmationRow>>> {
  const session = await requireSession();
  const parsed = pageInput.safeParse(input ?? {});
  if (!parsed.success) return fail("Invalid request");
  const page = parsed.data.page ?? 0;
  const admin = createAdminClient();

  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const { data, count, error } = await admin
    .from("shopify_cod_confirmations")
    .select(ROW_COLUMNS, { count: "exact" })
    .eq("organisation_id", session.organisation.id)
    .order("created_at", { ascending: false })
    .range(from, to)
    .returns<CodConfirmationRow[]>();

  if (error) {
    return fail(
      logSkeloError("SHOPIFY", "Failed to load COD confirmations", {
        organisationId: session.organisation.id,
        cause: error,
      }),
    );
  }

  return ok({ rows: data ?? [], total: count ?? 0 });
}
