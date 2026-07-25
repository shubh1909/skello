import "server-only";

import { BolnaApiError, initiateBolnaCall } from "@/lib/bolna/client";
import { isTerminalCallStatus } from "@/lib/campaigns/outcome-decision";
import {
  DEFAULT_MAX_CONNECTED_CALLS_PER_LEAD,
  evaluateConnectedCallCapForRows,
  resolveConnectedCallCap,
} from "@/lib/calls/connect-cap";
import { pooledMap } from "@/lib/campaigns/dispatch";
import {
  isWithinCallWindow,
  nextCallWindowOpen,
} from "@/lib/shopify/call-window";
import {
  decideCodOutcome,
  isCodOrder,
} from "@/lib/shopify/cod-confirmation-logic";
import { orderCodKeys } from "@/lib/shopify/webhooks";
import { createAdminClient } from "@/lib/supabase/admin";
import { APP_TIMEZONE } from "@/lib/time";
import type { CallStatus } from "@/types/call";
import type { ShopifyIntegration } from "@/types/shopify";

type Admin = ReturnType<typeof createAdminClient>;

// Per-tick ceilings — shares the cron tick with the other drainers. COD
// confirmation is low-volume (one per COD order), so generous.
const BATCH_LIMIT = 100;
const CONCURRENCY = 25;
const STUCK_IN_FLIGHT_MS = 30 * 60 * 1000;

// Clamp a candidate dial instant into the org's calling window (APP_TIMEZONE).
// Outside → next window open; inside or no window → unchanged. Mirrors recovery.
function clampToCallWindow(
  at: Date,
  start: string | null,
  end: string | null,
): Date {
  if (isWithinCallWindow(at, start, end, APP_TIMEZONE)) return at;
  return nextCallWindowOpen(at, start, APP_TIMEZONE);
}

interface CodSettingsRow {
  enabled: boolean;
  wait_minutes: number;
  max_attempts: number;
  retry_interval_seconds: number;
  agent_id: string | null;
  call_window_start: string | null;
  call_window_end: string | null;
  cod_gateway_names: string[] | null;
}

interface BolnaConfigRow {
  agent_id: string;
  api_key: string;
  from_phone_number: string | null;
  enabled: boolean;
}

async function loadCodSettings(
  admin: Admin,
  organisationId: string,
): Promise<CodSettingsRow | null> {
  const { data } = await admin
    .from("shopify_cod_settings")
    .select(
      "enabled, wait_minutes, max_attempts, retry_interval_seconds, agent_id, call_window_start, call_window_end, cod_gateway_names",
    )
    .eq("organisation_id", organisationId)
    .maybeSingle<CodSettingsRow>();
  return data ?? null;
}

async function loadBolnaConfig(
  admin: Admin,
  organisationId: string,
): Promise<BolnaConfigRow | null> {
  const { data } = await admin
    .from("bolna_integrations")
    .select("agent_id, api_key, from_phone_number, enabled")
    .eq("organisation_id", organisationId)
    .maybeSingle<BolnaConfigRow>();
  return data ?? null;
}

// =============================================================================
// ENQUEUE — turn a placed COD order into a planned confirmation call.
// =============================================================================

/**
 * Called (best-effort, via after()) from the Shopify webhook on an orders/*
 * event, alongside the cart-recovery settlement. Idempotent per (org, order_id):
 * the unique key collapses redelivery (orders/create → orders/updated → paid).
 *
 * Only COD orders are enqueued — detected from the payment-gateway labels
 * against the org's allowlist (or the built-in heuristic). Non-actionable orders
 * (no phone / no voice agent) are recorded as `skipped` for the dashboard.
 */
export async function enqueueCodConfirmation(input: {
  integration: ShopifyIntegration;
  payload: unknown;
}): Promise<void> {
  const keys = orderCodKeys(input.payload);
  if (!keys.orderId) return;

  const admin = createAdminClient();
  const orgId = input.integration.organisation_id;

  const settings = await loadCodSettings(admin, orgId);
  if (!settings || !settings.enabled) return; // feature off → do nothing

  // Only act on COD orders.
  if (
    !isCodOrder(
      {
        gateway: keys.gateway,
        paymentGatewayNames: keys.paymentGatewayNames,
        financialStatus: keys.financialStatus,
      },
      settings.cod_gateway_names,
    )
  ) {
    return;
  }

  // Already have a row for this order → leave it. A repeat delivery must not
  // restart the clock or resurrect a finished flow.
  const { data: existing } = await admin
    .from("shopify_cod_confirmations")
    .select("id")
    .eq("organisation_id", orgId)
    .eq("order_id", keys.orderId)
    .maybeSingle<{ id: string }>();
  if (existing) return;

  const bolna = await loadBolnaConfig(admin, orgId);
  const hasPhone = !!keys.phone;
  const agentId = settings.agent_id?.trim() || bolna?.agent_id?.trim() || null;
  const actionable = !!bolna?.enabled && !!agentId && hasPhone;

  const baseFields = {
    organisation_id: orgId,
    shop_domain: input.integration.shop_domain,
    order_id: keys.orderId,
    order_name: keys.orderName,
    order_total: keys.orderTotal,
    currency: keys.orderCurrency,
    phone: keys.phone,
    customer_name: keys.customerName,
    gateway: keys.gateway,
    max_attempts: settings.max_attempts,
    retry_interval_seconds: settings.retry_interval_seconds,
  };

  if (!actionable) {
    const skipReason = !hasPhone ? "no_phone" : "no_voice_agent";
    await admin.from("shopify_cod_confirmations").insert({
      ...baseFields,
      status: "skipped",
      skip_reason: skipReason,
    });
    return;
  }

  // First call = order time + wait_minutes, clamped into the calling window so
  // the stored next_attempt_at is always a callable instant.
  const orderMs = keys.orderCreatedAt
    ? Date.parse(keys.orderCreatedAt)
    : Number.NaN;
  const anchorMs = Number.isNaN(orderMs) ? Date.now() : orderMs;
  const firstCallAt = clampToCallWindow(
    new Date(anchorMs + settings.wait_minutes * 60_000),
    settings.call_window_start,
    settings.call_window_end,
  ).toISOString();

  await admin.from("shopify_cod_confirmations").insert({
    ...baseFields,
    status: "pending",
    agent_id: agentId,
    from_phone: bolna?.from_phone_number ?? null,
    attempt: 0,
    scheduled_at: firstCallAt,
    next_attempt_at: firstCallAt,
  });
}

// =============================================================================
// DISPATCH — drain due confirmation calls (cron tick). Mirrors
// dispatchDueRecoveries, minus the offer / WhatsApp / conversion machinery.
// =============================================================================

interface DueCod {
  id: string;
  organisation_id: string;
  lead_id: string | null;
  phone: string | null;
  agent_id: string | null;
  from_phone: string | null;
  attempt: number;
  max_attempts: number;
  retry_interval_seconds: number;
  order_id: string;
  order_name: string | null;
  order_total: number | null;
  currency: string | null;
  customer_name: string | null;
}

// First name only — the agent greets "Hi Rahul", not "Hi Rahul Gupta".
function firstName(full: string | null): string {
  return full?.trim().split(/\s+/)[0] ?? "";
}

// Flatten the order snapshot into the scalar variables the provider substitutes
// into the agent prompt. Every key here must exist as a {placeholder} in the
// agent's script for it to be spoken; unused keys are ignored. Values are always
// strings (empty when unknown) so the prompt never renders a literal "{var}".
export function buildCodVariables(r: DueCod): Record<string, unknown> {
  return {
    // --- Spoken context (must match {placeholders} in the agent script) ---
    customer_name: firstName(r.customer_name),
    order_name: r.order_name ?? "",
    order_total: r.order_total != null ? String(Math.round(r.order_total)) : "",
    currency: r.currency ?? "",
    // --- Internal correlation (not referenced by the prompt) ---
    organisation_id: r.organisation_id,
    cod_confirmation_id: r.id,
    order_id: r.order_id,
    lead_id: r.lead_id,
  };
}

async function reconcileStuckCodConfirmations(admin: Admin): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_IN_FLIGHT_MS).toISOString();
  await admin
    .from("shopify_cod_confirmations")
    .update({
      status: "failed",
      last_status: "failed",
      last_error: "No call result received — timed out",
    })
    .eq("status", "in_flight")
    .lt("updated_at", cutoff);
}

export interface CodDispatchResult {
  processed: number;
  fired: number;
}

export async function dispatchDueCodConfirmations(): Promise<CodDispatchResult> {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  await reconcileStuckCodConfirmations(admin);

  const { data, error } = await admin
    .from("shopify_cod_confirmations")
    .select(
      "id, organisation_id, lead_id, phone, agent_id, from_phone, attempt, max_attempts, retry_interval_seconds, order_id, order_name, order_total, currency, customer_name",
    )
    .eq("status", "pending")
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(BATCH_LIMIT)
    .returns<DueCod[]>();

  if (error) {
    console.error("[cod dispatch] fetch failed", error);
    throw error;
  }

  const queue = (data ?? []).filter(
    (r) => r.attempt < r.max_attempts && r.phone && r.agent_id,
  );
  if (queue.length === 0) return { processed: 0, fired: 0 };

  const orgIds = Array.from(new Set(queue.map((r) => r.organisation_id)));
  const [{ data: integrations }, { data: windowRows }] = await Promise.all([
    admin
      .from("bolna_integrations")
      .select(
        "organisation_id, api_key, from_phone_number, enabled, max_connected_calls_per_lead",
      )
      .in("organisation_id", orgIds)
      .returns<
        Array<{
          organisation_id: string;
          api_key: string;
          from_phone_number: string | null;
          enabled: boolean;
          max_connected_calls_per_lead: number | null;
        }>
      >(),
    admin
      .from("shopify_cod_settings")
      .select("organisation_id, call_window_start, call_window_end")
      .in("organisation_id", orgIds)
      .returns<
        Array<{
          organisation_id: string;
          call_window_start: string | null;
          call_window_end: string | null;
        }>
      >(),
  ]);
  const integrationByOrg = new Map(
    (integrations ?? []).map((i) => [i.organisation_id, i] as const),
  );
  const windowByOrg = new Map(
    (windowRows ?? []).map(
      (w) =>
        [
          w.organisation_id,
          { start: w.call_window_start, end: w.call_window_end },
        ] as const,
    ),
  );

  // Per-lead connected-call cap (the global per-org governor shared across every
  // outbound surface). Suppress — record as skipped — any phone already at the
  // org's ceiling in the rolling 48h window before spending a dial.
  const capEval = await evaluateConnectedCallCapForRows({
    admin,
    rows: queue,
    capForOrg: (orgId) => {
      const integ = integrationByOrg.get(orgId);
      return integ
        ? resolveConnectedCallCap(integ.max_connected_calls_per_lead)
        : DEFAULT_MAX_CONNECTED_CALLS_PER_LEAD;
    },
  });
  const cappedRows = queue.filter((r) =>
    capEval.isCapped(r.organisation_id, r.phone),
  );
  if (cappedRows.length > 0) {
    await Promise.all(
      cappedRows.map((r) =>
        admin
          .from("shopify_cod_confirmations")
          .update({
            status: "skipped",
            skip_reason: "per_lead_cap_reached",
            last_error: "Per-lead connected-call cap reached (48h)",
          })
          .eq("id", r.id)
          .eq("status", "pending"),
      ),
    );
  }
  const uncapped = queue.filter(
    (r) => !capEval.isCapped(r.organisation_id, r.phone),
  );
  if (uncapped.length === 0) return { processed: 0, fired: 0 };

  // Calling-window gate: defer rows whose org is outside its dial window.
  const now = new Date();
  const dialable: DueCod[] = [];
  const deferrals: Array<{ id: string; next: string }> = [];
  for (const r of uncapped) {
    const w = windowByOrg.get(r.organisation_id);
    if (!w || isWithinCallWindow(now, w.start, w.end, APP_TIMEZONE)) {
      dialable.push(r);
    } else {
      deferrals.push({
        id: r.id,
        next: nextCallWindowOpen(now, w.start, APP_TIMEZONE).toISOString(),
      });
    }
  }
  if (deferrals.length > 0) {
    await Promise.all(
      deferrals.map((d) =>
        admin
          .from("shopify_cod_confirmations")
          .update({ next_attempt_at: d.next })
          .eq("id", d.id)
          .eq("status", "pending"),
      ),
    );
  }
  if (dialable.length === 0) return { processed: 0, fired: 0 };

  const fired = await pooledMap(dialable, CONCURRENCY, async (r) => {
    const integration = integrationByOrg.get(r.organisation_id);
    if (!integration || !integration.enabled) {
      await admin
        .from("shopify_cod_confirmations")
        .update({
          status: "failed",
          attempt: r.attempt + 1,
          last_error: "Voice agent not configured/enabled",
        })
        .eq("id", r.id)
        .eq("status", "pending");
      return { id: r.id, ok: false };
    }

    // CAS claim — only proceed if still pending.
    const { data: claim } = await admin
      .from("shopify_cod_confirmations")
      .update({ status: "in_flight" })
      .eq("id", r.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle<{ id: string }>();
    if (!claim) return { id: r.id, ok: false };

    const fromPhoneForDial =
      r.from_phone || integration.from_phone_number || null;

    try {
      const result = await initiateBolnaCall({
        apiKey: integration.api_key,
        agentId: r.agent_id!,
        recipientPhone: r.phone!,
        fromPhone: fromPhoneForDial,
        metadata: buildCodVariables(r),
      });

      const { data: callRow, error: callErr } = await admin
        .from("calls")
        .insert({
          organisation_id: r.organisation_id,
          lead_id: r.lead_id,
          cod_confirmation_id: r.id,
          bolna_call_id: result.bolnaCallId,
          direction: "outbound",
          to_phone: r.phone,
          from_phone: fromPhoneForDial,
          agent_id: r.agent_id,
          status: "initiated",
        })
        .select("id")
        .single<{ id: string }>();

      if (callErr || !callRow) {
        await admin
          .from("shopify_cod_confirmations")
          .update({
            status: "pending",
            attempt: r.attempt + 1,
            last_error: callErr?.message ?? "Call insert failed",
            next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
          })
          .eq("id", r.id);
        return { id: r.id, ok: false };
      }

      await admin
        .from("shopify_cod_confirmations")
        .update({
          attempt: r.attempt + 1,
          last_call_id: callRow.id,
          last_error: null,
        })
        .eq("id", r.id);

      return { id: r.id, ok: true };
    } catch (err) {
      const reason =
        err instanceof BolnaApiError
          ? err.message
          : "Failed to reach the voice provider";

      await admin.from("calls").insert({
        organisation_id: r.organisation_id,
        lead_id: r.lead_id,
        cod_confirmation_id: r.id,
        to_phone: r.phone,
        from_phone: fromPhoneForDial,
        agent_id: r.agent_id,
        status: "failed",
        direction: "outbound",
        error_message: reason.slice(0, 500),
      });

      const newAttempt = r.attempt + 1;
      const exhausted = newAttempt >= r.max_attempts;
      await admin
        .from("shopify_cod_confirmations")
        .update({
          status: exhausted ? "failed" : "pending",
          attempt: newAttempt,
          last_status: "failed",
          last_error: reason.slice(0, 500),
          ...(exhausted
            ? {}
            : {
                next_attempt_at: new Date(
                  Date.now() + r.retry_interval_seconds * 1000,
                ).toISOString(),
              }),
        })
        .eq("id", r.id);
      return { id: r.id, ok: false };
    }
  });

  const okCount = fired.filter(
    (f) => f.status === "fulfilled" && f.value.ok,
  ).length;
  return { processed: dialable.length, fired: okCount };
}

// =============================================================================
// OUTCOME — advance a confirmation after its dial reaches a terminal state.
// Reaching the customer records the disposition and ends it; a non-connect
// under the cap re-arms; otherwise it fails. Retry depends ONLY on connectivity
// — `confirmed = no` still ends the flow (a human decision, not a reason to
// re-dial).
// =============================================================================

interface CodOutcomeRow {
  id: string;
  organisation_id: string;
  status: string;
  attempt: number;
  max_attempts: number;
  retry_interval_seconds: number;
}

export async function applyCodConfirmationOutcome(input: {
  confirmationId: string;
  callId: string;
  callStatus: CallStatus;
  // The extracted disposition (yes/no), or null when the agent didn't emit it.
  confirmed: boolean | null;
}): Promise<void> {
  const connected =
    input.callStatus === "in_progress" || input.callStatus === "completed";
  if (!connected && !isTerminalCallStatus(input.callStatus)) return;

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("shopify_cod_confirmations")
    .select(
      "id, organisation_id, status, attempt, max_attempts, retry_interval_seconds",
    )
    .eq("id", input.confirmationId)
    .maybeSingle<CodOutcomeRow>();
  if (!row) return;

  // Only transition while still in_flight — the first terminal/connect signal
  // wins; later duplicates no-op via the CAS below.
  if (row.status !== "in_flight") return;

  const decision = decideCodOutcome({
    callStatus: input.callStatus,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    retryIntervalSeconds: row.retry_interval_seconds,
    now: Date.now(),
  });
  if (decision.kind === "noop") return;

  const patch: Record<string, unknown> = {
    last_call_id: input.callId,
    last_status: input.callStatus,
  };

  if (decision.kind === "reached") {
    patch.status = "confirmed_call";
    patch.connected_at = new Date().toISOString();
    // Record the disposition verbatim. Null (agent didn't emit it) is kept null.
    patch.confirmed = input.confirmed;
  } else if (decision.kind === "fail") {
    patch.status = "failed";
  } else {
    // rearm — clamp the retry instant into the calling window so the stored
    // next_attempt_at (shown as "next call") is never an un-callable time.
    const { data: win } = await admin
      .from("shopify_cod_settings")
      .select("call_window_start, call_window_end")
      .eq("organisation_id", row.organisation_id)
      .maybeSingle<{
        call_window_start: string | null;
        call_window_end: string | null;
      }>();
    patch.status = "pending";
    patch.next_attempt_at = clampToCallWindow(
      new Date(decision.retryAtMs ?? Date.now()),
      win?.call_window_start ?? null,
      win?.call_window_end ?? null,
    ).toISOString();
  }

  await admin
    .from("shopify_cod_confirmations")
    .update(patch)
    .eq("id", row.id)
    .eq("status", "in_flight");
}
