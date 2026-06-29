import "server-only";

import { BolnaApiError, initiateBolnaCall } from "@/lib/bolna/client";
import { isTerminalCallStatus } from "@/lib/callbacks/outcome-decision";
import { pooledMap } from "@/lib/campaigns/dispatch";
import { findOrCreateShopifyLead } from "@/lib/shopify/lead";
import { normalizeAbandonedCheckout } from "@/lib/shopify/webhooks";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CallStatus } from "@/types/call";
import type { ShopifyIntegration } from "@/types/shopify";

type Admin = ReturnType<typeof createAdminClient>;

// Per-tick ceilings — recovery is low-volume, so generous. Shares the cron tick
// with the campaign + callback drainers.
const BATCH_LIMIT = 100;
const CONCURRENCY = 25;
const STUCK_IN_FLIGHT_MS = 30 * 60 * 1000;

interface RecoverySettingsRow {
  enabled: boolean;
  wait_minutes: number;
  max_attempts: number;
  retry_interval_seconds: number;
  agent_id: string | null;
  offer_type: string;
  offer_code: string | null;
  offer_label: string | null;
}

interface BolnaConfigRow {
  agent_id: string;
  api_key: string;
  from_phone_number: string | null;
  enabled: boolean;
}

async function loadSettings(
  admin: Admin,
  organisationId: string,
): Promise<RecoverySettingsRow | null> {
  const { data } = await admin
    .from("shopify_recovery_settings")
    .select(
      "enabled, wait_minutes, max_attempts, retry_interval_seconds, agent_id, offer_type, offer_code, offer_label",
    )
    .eq("organisation_id", organisationId)
    .maybeSingle<RecoverySettingsRow>();
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
// SCHEDULE — turn an abandoned checkout into a planned recovery call.
// =============================================================================

/**
 * Called (best-effort, via after()) from the Shopify webhook on a
 * checkouts/{create,update} event. Idempotent per (org, checkout_token): the
 * unique key collapses webhook retries, and a checkout that first arrives
 * without contact details (skipped) is upgraded to pending once a later update
 * carries a phone + consent.
 *
 * Gating (consented-only, voice-only): we only schedule a call when the cart has
 * a phone, marketing consent, and the org has the voice agent + recovery enabled.
 * Non-actionable carts are recorded as `skipped` (with a reason) for the
 * dashboard, never dialled.
 */
export async function scheduleRecoveryFromCheckout(input: {
  integration: ShopifyIntegration;
  payload: unknown;
}): Promise<void> {
  const checkout = normalizeAbandonedCheckout(input.payload);
  if (!checkout) return;

  const admin = createAdminClient();
  const orgId = input.integration.organisation_id;

  const settings = await loadSettings(admin, orgId);
  if (!settings || !settings.enabled) return; // feature off → do nothing

  const bolna = await loadBolnaConfig(admin, orgId);

  // Decide the eligibility + the skip reason (if any), in priority order.
  let skipReason: string | null = null;
  if (!bolna || !bolna.enabled) skipReason = "no_voice_agent";
  else if (!checkout.phone) skipReason = "no_phone";
  else if (!checkout.marketingConsent) skipReason = "no_consent";

  const agentId = settings.agent_id?.trim() || bolna?.agent_id?.trim() || null;
  if (!skipReason && !agentId) skipReason = "no_voice_agent";

  // Don't disturb a row that's already acting or finalised.
  const { data: existing } = await admin
    .from("shopify_recovery_attempts")
    .select("id, status")
    .eq("organisation_id", orgId)
    .eq("checkout_token", checkout.checkoutToken)
    .maybeSingle<{ id: string; status: string }>();
  if (
    existing &&
    ["in_flight", "succeeded", "canceled", "failed"].includes(existing.status)
  ) {
    return;
  }

  const baseFields = {
    organisation_id: orgId,
    shop_domain: input.integration.shop_domain,
    checkout_token: checkout.checkoutToken,
    customer_name: checkout.customerName,
    phone: checkout.phone,
    cart_total: checkout.cartTotal,
    currency: checkout.currency,
    recovery_url: checkout.recoveryUrl,
    cart_items: checkout.lineItems,
  };

  // --- Not actionable → record/keep a skipped row (idempotent) ---------------
  if (skipReason) {
    if (existing) {
      await admin
        .from("shopify_recovery_attempts")
        .update({ ...baseFields, status: "skipped", skip_reason: skipReason })
        .eq("id", existing.id)
        .eq("status", "skipped");
      return;
    }
    await admin.from("shopify_recovery_attempts").insert({
      ...baseFields,
      status: "skipped",
      skip_reason: skipReason,
    });
    return;
  }

  // --- Actionable → schedule (or promote a skipped row to) pending -----------
  const leadId = await findOrCreateShopifyLead({
    organisationId: orgId,
    phone: checkout.phone,
    name: checkout.customerName,
    cart: {
      checkoutToken: checkout.checkoutToken,
      cartTotal: checkout.cartTotal,
      currency: checkout.currency,
      recoveryUrl: checkout.recoveryUrl,
      lineItems: checkout.lineItems,
    },
  });

  const offerLabel =
    settings.offer_type === "none" ? null : settings.offer_label;
  const offerCode = settings.offer_type === "none" ? null : settings.offer_code;
  const fromPhone = bolna?.from_phone_number ?? null;

  if (existing) {
    // Keep an already-pending row's timer; only refresh context + offer. A
    // skipped row that's now eligible gets a fresh schedule.
    const patch: Record<string, unknown> = {
      ...baseFields,
      lead_id: leadId,
      agent_id: agentId,
      from_phone: fromPhone,
      max_attempts: settings.max_attempts,
      retry_interval_seconds: settings.retry_interval_seconds,
      offer_label: offerLabel,
      offer_code: offerCode,
      skip_reason: null,
    };
    if (existing.status === "skipped") {
      const when = new Date(
        Date.now() + settings.wait_minutes * 60_000,
      ).toISOString();
      patch.status = "pending";
      patch.scheduled_at = when;
      patch.next_attempt_at = when;
      patch.attempt = 0;
    }
    await admin
      .from("shopify_recovery_attempts")
      .update(patch)
      .eq("id", existing.id);
    return;
  }

  const when = new Date(
    Date.now() + settings.wait_minutes * 60_000,
  ).toISOString();
  await admin.from("shopify_recovery_attempts").insert({
    ...baseFields,
    lead_id: leadId,
    status: "pending",
    agent_id: agentId,
    from_phone: fromPhone,
    attempt: 0,
    max_attempts: settings.max_attempts,
    retry_interval_seconds: settings.retry_interval_seconds,
    scheduled_at: when,
    next_attempt_at: when,
    offer_label: offerLabel,
    offer_code: offerCode,
  });
}

// =============================================================================
// CANCEL / CONVERT — an order completed, so the cart was recovered.
// =============================================================================

export async function cancelRecoveryForOrder(input: {
  integration: ShopifyIntegration;
  checkoutToken: string | null;
}): Promise<void> {
  if (!input.checkoutToken) return;
  const admin = createAdminClient();

  const { data: attempt } = await admin
    .from("shopify_recovery_attempts")
    .select("id, status, converted_at")
    .eq("organisation_id", input.integration.organisation_id)
    .eq("checkout_token", input.checkoutToken)
    .maybeSingle<{ id: string; status: string; converted_at: string | null }>();
  if (!attempt) return;

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { converted_at: attempt.converted_at ?? now };
  // Stop a pending/in-flight recovery — they already bought.
  if (attempt.status === "pending" || attempt.status === "in_flight") {
    patch.status = "canceled";
    patch.canceled_at = now;
  }
  await admin
    .from("shopify_recovery_attempts")
    .update(patch)
    .eq("id", attempt.id);
}

// =============================================================================
// DISPATCH — drain due recovery calls (cron tick). Mirrors dispatchDueCallbacks.
// =============================================================================

interface DueRecovery {
  id: string;
  organisation_id: string;
  lead_id: string | null;
  phone: string | null;
  agent_id: string | null;
  from_phone: string | null;
  attempt: number;
  max_attempts: number;
  retry_interval_seconds: number;
  customer_name: string | null;
  cart_total: number | null;
  currency: string | null;
  recovery_url: string | null;
  cart_items: unknown;
  offer_label: string | null;
  offer_code: string | null;
}

async function reconcileStuckRecoveries(admin: Admin): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_IN_FLIGHT_MS).toISOString();
  await admin
    .from("shopify_recovery_attempts")
    .update({
      status: "failed",
      last_status: "failed",
      last_error: "No call result received — timed out",
    })
    .eq("status", "in_flight")
    .lt("updated_at", cutoff);
}

export interface RecoveryDispatchResult {
  processed: number;
  fired: number;
}

export async function dispatchDueRecoveries(): Promise<RecoveryDispatchResult> {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  await reconcileStuckRecoveries(admin);

  const { data, error } = await admin
    .from("shopify_recovery_attempts")
    .select(
      "id, organisation_id, lead_id, phone, agent_id, from_phone, attempt, max_attempts, retry_interval_seconds, customer_name, cart_total, currency, recovery_url, cart_items, offer_label, offer_code",
    )
    .eq("status", "pending")
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(BATCH_LIMIT)
    .returns<DueRecovery[]>();

  if (error) {
    console.error("[recovery dispatch] fetch failed", error);
    throw error;
  }

  const queue = (data ?? []).filter(
    (r) => r.attempt < r.max_attempts && r.phone && r.agent_id,
  );
  if (queue.length === 0) return { processed: 0, fired: 0 };

  const orgIds = Array.from(new Set(queue.map((r) => r.organisation_id)));
  const { data: integrations } = await admin
    .from("bolna_integrations")
    .select("organisation_id, api_key, from_phone_number, enabled")
    .in("organisation_id", orgIds)
    .returns<
      Array<{
        organisation_id: string;
        api_key: string;
        from_phone_number: string | null;
        enabled: boolean;
      }>
    >();
  const integrationByOrg = new Map(
    (integrations ?? []).map((i) => [i.organisation_id, i] as const),
  );

  const fired = await pooledMap(queue, CONCURRENCY, async (r) => {
    const integration = integrationByOrg.get(r.organisation_id);
    if (!integration || !integration.enabled) {
      await admin
        .from("shopify_recovery_attempts")
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
      .from("shopify_recovery_attempts")
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
        metadata: {
          organisation_id: r.organisation_id,
          shopify_recovery_attempt_id: r.id,
          lead_id: r.lead_id,
          customer_name: r.customer_name,
          cart_total: r.cart_total,
          currency: r.currency,
          recovery_url: r.recovery_url,
          cart_items: r.cart_items,
          offer_label: r.offer_label,
          offer_code: r.offer_code,
        },
      });

      const { data: callRow, error: callErr } = await admin
        .from("calls")
        .insert({
          organisation_id: r.organisation_id,
          lead_id: r.lead_id,
          shopify_recovery_attempt_id: r.id,
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
          .from("shopify_recovery_attempts")
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
        .from("shopify_recovery_attempts")
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
        shopify_recovery_attempt_id: r.id,
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
        .from("shopify_recovery_attempts")
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
  return { processed: queue.length, fired: okCount };
}

// =============================================================================
// OUTCOME — advance a recovery attempt after its dial reaches a terminal state.
// Mirrors applyScheduledCallbackOutcome: reaching the customer ends it; a
// technical failure under the cap re-arms; otherwise it fails.
// =============================================================================

interface AttemptOutcomeRow {
  id: string;
  status: string;
  attempt: number;
  max_attempts: number;
  retry_interval_seconds: number;
}

export async function applyShopifyRecoveryOutcome(input: {
  attemptId: string;
  callId: string;
  callStatus: CallStatus;
}): Promise<void> {
  if (!isTerminalCallStatus(input.callStatus)) return;

  const admin = createAdminClient();
  const { data: attempt } = await admin
    .from("shopify_recovery_attempts")
    .select("id, status, attempt, max_attempts, retry_interval_seconds")
    .eq("id", input.attemptId)
    .maybeSingle<AttemptOutcomeRow>();
  if (!attempt || attempt.status !== "in_flight") return;

  const patch: Record<string, unknown> = {
    last_call_id: input.callId,
    last_status: input.callStatus,
  };

  if (input.callStatus === "completed") {
    patch.status = "succeeded"; // we reached the shopper
  } else if (attempt.attempt >= attempt.max_attempts) {
    patch.status = "failed";
  } else {
    patch.status = "pending";
    patch.next_attempt_at = new Date(
      Date.now() + attempt.retry_interval_seconds * 1000,
    ).toISOString();
  }

  await admin
    .from("shopify_recovery_attempts")
    .update(patch)
    .eq("id", attempt.id)
    .eq("status", "in_flight");
}
