import "server-only";

import { BolnaApiError, initiateBolnaCall } from "@/lib/bolna/client";
import { isTerminalCallStatus } from "@/lib/callbacks/outcome-decision";
import { pooledMap } from "@/lib/campaigns/dispatch";
import {
  isWithinCallWindow,
  nextCallWindowOpen,
} from "@/lib/shopify/call-window";
import { findOrCreateShopifyLead } from "@/lib/shopify/lead";
import { normalizeAbandonedCheckout } from "@/lib/shopify/webhooks";
import { createAdminClient } from "@/lib/supabase/admin";
import { APP_TIMEZONE } from "@/lib/time";
import type { CallStatus } from "@/types/call";
import type { RecoveryCartItem, ShopifyIntegration } from "@/types/shopify";

type Admin = ReturnType<typeof createAdminClient>;

// Per-tick ceilings — recovery is low-volume, so generous. Shares the cron tick
// with the campaign + callback drainers.
const BATCH_LIMIT = 100;
const CONCURRENCY = 25;
const STUCK_IN_FLIGHT_MS = 30 * 60 * 1000;

// Clamp a candidate dial instant into the org's calling window (evaluated in
// APP_TIMEZONE). Outside the window → the next window open; inside, or no window
// configured → unchanged. Applied wherever we WRITE next_attempt_at so the stored
// (and UI-displayed) time is always callable — the dispatcher's runtime deferral
// stays as the safety net for anything that slips through.
function clampToCallWindow(
  at: Date,
  start: string | null,
  end: string | null,
): Date {
  if (isWithinCallWindow(at, start, end, APP_TIMEZONE)) return at;
  return nextCallWindowOpen(at, start, APP_TIMEZONE);
}

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
  voice_enabled: boolean;
  whatsapp_enabled: boolean;
  whatsapp_template_name: string | null;
  call_window_start: string | null;
  call_window_end: string | null;
}

interface BolnaConfigRow {
  agent_id: string;
  api_key: string;
  from_phone_number: string | null;
  enabled: boolean;
}

interface WhatsAppConfigRow {
  provider: string;
  template_name: string | null;
  enabled: boolean;
}

async function loadSettings(
  admin: Admin,
  organisationId: string,
): Promise<RecoverySettingsRow | null> {
  const { data } = await admin
    .from("shopify_recovery_settings")
    .select(
      "enabled, wait_minutes, max_attempts, retry_interval_seconds, agent_id, offer_type, offer_code, offer_label, offer_discount_value, offer_discount_kind, voice_enabled, whatsapp_enabled, whatsapp_template_name, call_window_start, call_window_end",
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

async function loadWhatsAppConfig(
  admin: Admin,
  organisationId: string,
): Promise<WhatsAppConfigRow | null> {
  const { data } = await admin
    .from("whatsapp_integrations")
    .select("provider, template_name, enabled")
    .eq("organisation_id", organisationId)
    .maybeSingle<WhatsAppConfigRow>();
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
  const wa = await loadWhatsAppConfig(admin, orgId);

  // Per-channel eligibility. We message regardless of marketing consent (it's
  // recorded, not gating) — only a missing phone or an unconfigured channel
  // makes it non-actionable. Voice and WhatsApp are independent.
  const hasPhone = !!checkout.phone;
  const agentId = settings.agent_id?.trim() || bolna?.agent_id?.trim() || null;
  const voiceActionable =
    settings.voice_enabled && !!bolna?.enabled && !!agentId && hasPhone;
  const waTemplate =
    settings.whatsapp_template_name?.trim() ||
    wa?.template_name?.trim() ||
    null;
  const whatsappActionable =
    settings.whatsapp_enabled && !!wa?.enabled && !!waTemplate && hasPhone;

  // Don't disturb a row whose voice track is already acting or finalised.
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
    abandoned_at: checkout.abandonedAt,
    cart_total: checkout.cartTotal,
    currency: checkout.currency,
    recovery_url: checkout.recoveryUrl,
    cart_items: checkout.lineItems,
  };

  // Per-channel skip reasons, surfaced in the dashboard.
  const voiceSkip = !hasPhone
    ? "no_phone"
    : !settings.voice_enabled
      ? "voice_off"
      : "no_voice_agent";
  const whatsappSkip = !settings.whatsapp_enabled
    ? null
    : !hasPhone
      ? "no_phone"
      : !wa?.enabled
        ? "no_whatsapp"
        : "no_template";
  const waSkipStatus = settings.whatsapp_enabled ? "skipped" : "none";

  // --- Neither channel actionable → record/keep a skipped row (idempotent) ---
  if (!voiceActionable && !whatsappActionable) {
    const skipPatch = {
      ...baseFields,
      status: "skipped",
      skip_reason: voiceSkip,
      whatsapp_status: waSkipStatus,
      whatsapp_skip_reason: whatsappSkip,
    };
    if (existing) {
      await admin
        .from("shopify_recovery_attempts")
        .update(skipPatch)
        .eq("id", existing.id)
        .eq("status", "skipped");
      return;
    }
    await admin.from("shopify_recovery_attempts").insert(skipPatch);
    return;
  }

  // --- At least one channel actionable → schedule ----------------------------
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

  // Timing: voice always dials first, at now+wait. WhatsApp trails the voice
  // track — it is RELEASED (re-anchored to now) the moment the connected call
  // ends, or when voice gives up, in applyShopifyRecoveryOutcome. The timestamp
  // stamped here is only a BACKSTOP so a dropped provider webhook can't strand a
  // held message forever: once the whole voice budget elapses, WhatsApp sends
  // anyway (this is also the no-connect fallback). With no voice to wait for,
  // WhatsApp sends on its own at now+wait.
  const nowMs = Date.now();
  const waitMs = settings.wait_minutes * 60_000;
  const bothRun = voiceActionable && whatsappActionable;

  // Clamp a candidate dial time INTO the org's calling window: if it lands
  // outside, move it to the next window open. This keeps the stored
  // next_attempt_at truthful up front, so the UI never shows an un-callable
  // time (e.g. a 9pm abandonment + 30m wait no longer displays 9:30pm when the
  // window closed at 9pm — it shows tomorrow's open). The dispatcher's runtime
  // deferral stays as the safety net for anything scheduled earlier.
  const clampToWindow = (ms: number): string =>
    clampToCallWindow(
      new Date(nowMs + ms),
      settings.call_window_start,
      settings.call_window_end,
    ).toISOString();

  const voiceWhen = clampToWindow(waitMs);
  // Upper bound on how long the voice track can run before it is exhausted.
  const voiceBudgetMs =
    waitMs + settings.max_attempts * settings.retry_interval_seconds * 1000;
  const waWhen = clampToWindow(bothRun ? voiceBudgetMs : waitMs);

  const offerFields = {
    offer_label: offerLabel,
    offer_code: offerCode,
    offer_discount_value: offerDiscountValue,
    offer_discount_kind: offerDiscountKind,
  };

  // Voice track (top-level status). When voice isn't actionable but WhatsApp is,
  // keep the row active (pending) with no agent so the voice dispatcher skips it.
  const voiceFields = voiceActionable
    ? {
        status: "pending",
        agent_id: agentId,
        from_phone: fromPhone,
        max_attempts: settings.max_attempts,
        retry_interval_seconds: settings.retry_interval_seconds,
        scheduled_at: voiceWhen,
        next_attempt_at: voiceWhen,
        skip_reason: null,
      }
    : {
        status: "pending",
        agent_id: null,
        max_attempts: settings.max_attempts,
        retry_interval_seconds: settings.retry_interval_seconds,
        skip_reason: "no_voice_agent",
      };

  const waFields = whatsappActionable
    ? {
        whatsapp_status: "pending",
        whatsapp_next_at: waWhen,
        whatsapp_skip_reason: null,
      }
    : { whatsapp_status: waSkipStatus, whatsapp_skip_reason: whatsappSkip };

  if (existing && existing.status !== "skipped") {
    // Already active — refresh context/offer only; keep the running timers +
    // channel statuses so we never restart the clock mid-flight.
    await admin
      .from("shopify_recovery_attempts")
      .update({
        ...baseFields,
        lead_id: leadId,
        agent_id: voiceActionable ? agentId : null,
        from_phone: fromPhone,
        max_attempts: settings.max_attempts,
        retry_interval_seconds: settings.retry_interval_seconds,
        ...offerFields,
        skip_reason: voiceActionable ? null : "no_voice_agent",
      })
      .eq("id", existing.id);
    return;
  }

  const activation = {
    ...baseFields,
    lead_id: leadId,
    ...offerFields,
    ...voiceFields,
    ...waFields,
    attempt: 0,
    whatsapp_attempt: 0,
  };

  if (existing) {
    await admin
      .from("shopify_recovery_attempts")
      .update(activation)
      .eq("id", existing.id);
    return;
  }
  await admin.from("shopify_recovery_attempts").insert(activation);
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
    .select("id, status, whatsapp_status, converted_at")
    .eq("organisation_id", input.integration.organisation_id)
    .eq("checkout_token", input.checkoutToken)
    .maybeSingle<{
      id: string;
      status: string;
      whatsapp_status: string;
      converted_at: string | null;
    }>();
  if (!attempt) return;

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    converted_at: attempt.converted_at ?? now,
  };
  // Stop a pending/in-flight recovery on both channels — they already bought.
  if (attempt.status === "pending" || attempt.status === "in_flight") {
    patch.status = "canceled";
    patch.canceled_at = now;
  }
  if (
    attempt.whatsapp_status === "pending" ||
    attempt.whatsapp_status === "in_flight"
  ) {
    patch.whatsapp_status = "canceled";
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
// Used for the percentage label; currency amounts use wholeAmount (below).
function money(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

// Currency amount → whole units, no paise. The voice agent quotes "5000 rupees",
// never "4999.50", and the WhatsApp copy matches. Rounds to the nearest rupee.
function wholeAmount(n: number): string {
  return String(Math.round(n));
}

// First name only — the agent greets "Hi Rahul", not "Hi Rahul Gupta". Splits on
// whitespace and takes the first token; empty/null → "".
function firstName(full: string | null): string {
  return full?.trim().split(/\s+/)[0] ?? "";
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
    cartSummary: items.length > 1 ? `${top} along with others` : top,
    itemCount: items.length,
  };
}

// cart_total is the original (pre-offer) value; the discount is derived from the
// snapshotted offer. Returns nulls when there's no usable offer/total.
function applyOffer(
  cartTotal: number | null,
  value: number | null,
  kind: string | null,
): {
  discountAmount: number | null;
  discountedTotal: number | null;
  percentLabel: string;
} {
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

// The cart/offer fields buildRecoveryVariables reads. DueRecovery (voice) and
// the WhatsApp due row both satisfy this, so both channels share one flattener.
export interface RecoveryVariableSource {
  id: string;
  organisation_id: string;
  lead_id: string | null;
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

// Build the flat scalar context (→ Bolna {variables} / WhatsApp template params)
// plus the internal correlation IDs (unused by the prompt, kept for tracing).
export function buildRecoveryVariables(
  r: RecoveryVariableSource,
): Record<string, unknown> {
  const items = parseCartItems(r.cart_items);
  const { topProduct, cartSummary, itemCount } = summariseCart(items);
  const { discountAmount, discountedTotal, percentLabel } = applyOffer(
    r.cart_total,
    r.offer_discount_value,
    r.offer_discount_kind,
  );

  return {
    // --- Spoken context (must match {placeholders} in the Bolna agent script) ---
    customer_name: firstName(r.customer_name),
    top_product: topProduct,
    cart_summary: cartSummary,
    item_count: String(itemCount),
    currency: r.currency ?? "",
    cart_total: r.cart_total != null ? wholeAmount(r.cart_total) : "",
    discount_name: r.offer_label ?? "",
    discount_code: r.offer_code ?? "",
    discount_percentage: percentLabel,
    discount_amount: discountAmount != null ? wholeAmount(discountAmount) : "",
    discounted_cart_total:
      discountedTotal != null ? wholeAmount(discountedTotal) : "",
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
    // Never dial a cart that already converted. cancelRecoveryForOrder normally
    // flips these to `canceled`, but guard here too so an order landing mid-tick
    // can't slip a dial through against a shopper who already bought.
    .is("converted_at", null)
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
  const [{ data: integrations }, { data: windowRows }] = await Promise.all([
    admin
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
      >(),
    admin
      .from("shopify_recovery_settings")
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

  // Calling-window gate: rows whose org is outside its configured dial window
  // are deferred to the next window open (in APP_TIMEZONE) rather than dialled.
  const now = new Date();
  const dialable: DueRecovery[] = [];
  const deferrals: Array<{ id: string; next: string }> = [];
  for (const r of queue) {
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
          .from("shopify_recovery_attempts")
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
  return { processed: dialable.length, fired: okCount };
}

// =============================================================================
// OUTCOME — advance a recovery attempt after its dial reaches a terminal state.
// Mirrors applyScheduledCallbackOutcome: reaching the customer ends it; a
// technical failure under the cap re-arms; otherwise it fails.
// =============================================================================

interface AttemptOutcomeRow {
  id: string;
  organisation_id: string;
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
  // "Connected" = the shopper actually picked up. A call is answered
  // (`in_progress`) before it `completed`; either signal means we reached them.
  // Reaching the customer once is the whole job — from here we never re-dial,
  // regardless of how the call later ends. Non-connect statuses (no_answer /
  // busy / failed-to-initiate / canceled) carry a retry verdict; ringing /
  // initiated carry none.
  const connected =
    input.callStatus === "in_progress" || input.callStatus === "completed";
  if (!connected && !isTerminalCallStatus(input.callStatus)) return;

  const admin = createAdminClient();
  const { data: attempt } = await admin
    .from("shopify_recovery_attempts")
    .select(
      "id, organisation_id, status, attempt, max_attempts, retry_interval_seconds",
    )
    .eq("id", input.attemptId)
    .maybeSingle<AttemptOutcomeRow>();
  if (!attempt) return;

  // Voice-track transition — only while the row is still in_flight (first
  // terminal/connect signal wins; later duplicates no-op via the CAS below).
  if (attempt.status === "in_flight") {
    const patch: Record<string, unknown> = {
      last_call_id: input.callId,
      last_status: input.callStatus,
    };

    if (connected) {
      // Reached the shopper — done. Stamp the connect so we have an explicit
      // "we spoke to them" marker and never queue another dial.
      patch.status = "succeeded";
      patch.connected_at = new Date().toISOString();
    } else if (attempt.attempt >= attempt.max_attempts) {
      patch.status = "failed";
    } else {
      // Re-arm for a retry — clamped into the calling window so the stored
      // next_attempt_at (shown as "next call") is never an un-callable time.
      const retryAt = new Date(
        Date.now() + attempt.retry_interval_seconds * 1000,
      );
      const { data: win } = await admin
        .from("shopify_recovery_settings")
        .select("call_window_start, call_window_end")
        .eq("organisation_id", attempt.organisation_id)
        .maybeSingle<{
          call_window_start: string | null;
          call_window_end: string | null;
        }>();
      patch.status = "pending";
      patch.next_attempt_at = clampToCallWindow(
        retryAt,
        win?.call_window_start ?? null,
        win?.call_window_end ?? null,
      ).toISOString();
    }

    await admin
      .from("shopify_recovery_attempts")
      .update(patch)
      .eq("id", attempt.id)
      .eq("status", "in_flight");
  }

  // Release a WhatsApp held behind the voice track. Two triggers:
  //   - the connected call has ENDED (`completed`) → send now, right after the
  //     call — NOT on `in_progress`, so we never message a shopper mid-call.
  //   - voice gave up (a non-connect terminal on the last attempt) → send now
  //     as the no-connect fallback.
  // This runs independently of the in_flight CAS above so a `completed` landing
  // after an earlier `in_progress` (which already flipped the row to succeeded)
  // still releases the message. Guarded on whatsapp_status='pending' so a send
  // that already fired — or was canceled on conversion — is never disturbed.
  const connectedCallEnded = input.callStatus === "completed";
  const voiceExhaustedNoConnect =
    !connected && attempt.attempt >= attempt.max_attempts;
  if (connectedCallEnded || voiceExhaustedNoConnect) {
    await admin
      .from("shopify_recovery_attempts")
      .update({ whatsapp_next_at: new Date().toISOString() })
      .eq("id", attempt.id)
      .eq("whatsapp_status", "pending");
  }
}
