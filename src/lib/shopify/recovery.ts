import "server-only";

import { BolnaApiError, initiateBolnaCall } from "@/lib/bolna/client";
import { isTerminalCallStatus } from "@/lib/callbacks/outcome-decision";
import { pooledMap } from "@/lib/campaigns/dispatch";
import { findOrCreateShopifyLead } from "@/lib/shopify/lead";
import { normalizeAbandonedCheckout } from "@/lib/shopify/webhooks";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CallStatus } from "@/types/call";
import type { RecoveryCartItem, ShopifyIntegration } from "@/types/shopify";

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
  offer_discount_value: number | null;
  offer_discount_kind: string | null;
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
      "enabled, wait_minutes, max_attempts, retry_interval_seconds, agent_id, offer_type, offer_code, offer_label, offer_discount_value, offer_discount_kind",
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
 * Gating (voice-only): we schedule a call for any cart that has a phone once the
 * org has the voice agent + recovery enabled. Marketing consent is recorded on
 * the row but does NOT gate the call. Non-actionable carts (no phone / no voice
 * agent) are recorded as `skipped` (with a reason) for the dashboard, never
 * dialled.
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

  // Decide the eligibility + the skip reason (if any), in priority order. We
  // call regardless of marketing consent now — only a missing phone or an
  // unconfigured voice agent makes a cart non-actionable.
  let skipReason: string | null = null;
  if (!bolna || !bolna.enabled) skipReason = "no_voice_agent";
  else if (!checkout.phone) skipReason = "no_phone";

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
    email: checkout.email,
    phone: checkout.phone,
    marketing_consent: checkout.marketingConsent,
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

  const noOffer = settings.offer_type === "none";
  const offerLabel = noOffer ? null : settings.offer_label;
  const offerCode = noOffer ? null : settings.offer_code;
  const offerDiscountValue = noOffer ? null : settings.offer_discount_value;
  const offerDiscountKind = noOffer ? null : settings.offer_discount_kind;
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
      offer_discount_value: offerDiscountValue,
      offer_discount_kind: offerDiscountKind,
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
    offer_discount_value: offerDiscountValue,
    offer_discount_kind: offerDiscountKind,
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
  offer_discount_value: number | null;
  offer_discount_kind: string | null;
}

// ---------------------------------------------------------------------------
// Conversation context — flatten the cart snapshot into the scalar variables
// Bolna substitutes into the agent prompt. Every key here must exist as a
// {placeholder} in the agent's Bolna script for the agent to speak it; keys it
// doesn't reference are simply ignored. Values are always strings (empty when
// unknown) so the prompt never renders a literal "{variable}".
// ---------------------------------------------------------------------------

// Money → speakable string: 2dp, trailing ".00" trimmed (5000, not 5000.00).
function money(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function parseCartItems(raw: unknown): RecoveryCartItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => {
      const it = x as Partial<RecoveryCartItem>;
      const title = typeof it.title === "string" ? it.title : null;
      if (!title) return null;
      const quantity =
        typeof it.quantity === "number" && it.quantity > 0 ? it.quantity : 1;
      const lineValue = typeof it.lineValue === "number" ? it.lineValue : 0;
      return { title, quantity, lineValue };
    })
    .filter((x): x is RecoveryCartItem => x !== null);
}

// Highest-value product leads; ">1 product" appends "and others".
function summariseCart(items: RecoveryCartItem[]): {
  topProduct: string;
  cartSummary: string;
  itemCount: number;
} {
  if (items.length === 0) {
    return { topProduct: "", cartSummary: "", itemCount: 0 };
  }
  const top = [...items].sort((a, b) => b.lineValue - a.lineValue)[0].title;
  return {
    topProduct: top,
    cartSummary: items.length > 1 ? `${top} and others` : top,
    itemCount: items.length,
  };
}

// cart_total is the original (pre-offer) value; the discount is derived from the
// snapshotted offer. Returns nulls when there's no usable offer/total.
function applyOffer(
  cartTotal: number | null,
  value: number | null,
  kind: string | null,
): { discountAmount: number | null; discountedTotal: number | null; percentLabel: string } {
  if (cartTotal == null || value == null || value <= 0) {
    return { discountAmount: null, discountedTotal: null, percentLabel: "" };
  }
  if (kind === "percentage") {
    const amount = Math.min((cartTotal * value) / 100, cartTotal);
    return {
      discountAmount: amount,
      discountedTotal: cartTotal - amount,
      percentLabel: `${money(value)}%`,
    };
  }
  if (kind === "fixed_amount") {
    const amount = Math.min(value, cartTotal);
    return {
      discountAmount: amount,
      discountedTotal: cartTotal - amount,
      percentLabel: "",
    };
  }
  return { discountAmount: null, discountedTotal: null, percentLabel: "" };
}

// Build the user_data object handed to Bolna (→ {variables} in the agent prompt)
// plus the internal correlation IDs (unused by the prompt, kept for tracing).
function buildRecoveryVariables(r: DueRecovery): Record<string, unknown> {
  const items = parseCartItems(r.cart_items);
  const { topProduct, cartSummary, itemCount } = summariseCart(items);
  const { discountAmount, discountedTotal, percentLabel } = applyOffer(
    r.cart_total,
    r.offer_discount_value,
    r.offer_discount_kind,
  );

  return {
    // --- Spoken context (must match {placeholders} in the Bolna agent script) ---
    customer_name: r.customer_name ?? "",
    top_product: topProduct,
    cart_summary: cartSummary,
    item_count: String(itemCount),
    currency: r.currency ?? "",
    cart_total: r.cart_total != null ? money(r.cart_total) : "",
    discount_name: r.offer_label ?? "",
    discount_code: r.offer_code ?? "",
    discount_percentage: percentLabel,
    discount_amount: discountAmount != null ? money(discountAmount) : "",
    discounted_cart_total: discountedTotal != null ? money(discountedTotal) : "",
    recovery_url: r.recovery_url ?? "",
    // --- Internal correlation (not referenced by the prompt) ---
    organisation_id: r.organisation_id,
    shopify_recovery_attempt_id: r.id,
    lead_id: r.lead_id,
  };
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
      "id, organisation_id, lead_id, phone, agent_id, from_phone, attempt, max_attempts, retry_interval_seconds, customer_name, cart_total, currency, recovery_url, cart_items, offer_label, offer_code, offer_discount_value, offer_discount_kind",
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
        metadata: buildRecoveryVariables(r),
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
