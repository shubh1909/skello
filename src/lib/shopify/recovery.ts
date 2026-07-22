import "server-only";

import { BolnaApiError, initiateBolnaCall } from "@/lib/bolna/client";
import { isTerminalCallStatus } from "@/lib/callbacks/outcome-decision";
import {
  DEFAULT_MAX_CONNECTED_CALLS_PER_LEAD,
  evaluateConnectedCallCapForRows,
  resolveConnectedCallCap,
} from "@/lib/calls/connect-cap";
import { pooledMap } from "@/lib/campaigns/dispatch";
import {
  buildShortRecoveryLink,
  newShortToken,
} from "@/lib/shopify/app-proxy";
import {
  isWithinCallWindow,
  nextCallWindowOpen,
} from "@/lib/shopify/call-window";
import { findOrCreateShopifyLead } from "@/lib/shopify/lead";
import { normalizeAbandonedCheckout } from "@/lib/shopify/webhooks";
import { createAdminClient } from "@/lib/supabase/admin";
import { APP_TIMEZONE } from "@/lib/time";
import type { CallStatus } from "@/types/call";
import type {
  RecoveryCartItem,
  RecoveryOutcome,
  ShopifyIntegration,
} from "@/types/shopify";

type Admin = ReturnType<typeof createAdminClient>;

// Per-tick ceilings — recovery is low-volume, so generous. Shares the cron tick
// with the campaign + callback drainers.
const BATCH_LIMIT = 100;
const CONCURRENCY = 25;
const STUCK_IN_FLIGHT_MS = 30 * 60 * 1000;

// A checkout is NOT an abandoned cart the moment it's created — Shopify only
// considers it abandoned ~10 minutes after contact info is added without the
// order completing. We mirror that threshold exactly: until it elapses with no
// order, the cart is "in checkout", not abandoned. A purchase inside this window
// was never abandoned (a normal fast checkout), so it is neither dialled nor
// listed as abandoned. This is SEPARATE from the call delay
// (settings.wait_minutes): the call clock starts only once the cart becomes
// abandoned, i.e. first dial = checkout + this threshold + wait_minutes.
//
// SCOPE: this is a scheduling + display rule and nothing more. It does NOT
// define a recovery — that is `recovery_outcome`, stamped at settlement from
// whether we actually reached the buyer first. The 20260720 migration borrowed
// this threshold to answer that question and got 21% precision; 20260722 undid
// it. Keep the two concerns apart.
export const ABANDONMENT_THRESHOLD_MINUTES = 10;
const ABANDONMENT_THRESHOLD_MS = ABANDONMENT_THRESHOLD_MINUTES * 60_000;

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
  offer_code_spoken: string | null;
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
      "enabled, wait_minutes, max_attempts, retry_interval_seconds, agent_id, offer_type, offer_code, offer_code_spoken, offer_label, offer_discount_value, offer_discount_kind, voice_enabled, whatsapp_enabled, whatsapp_template_name, call_window_start, call_window_end",
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
    cart_token: checkout.cartToken,
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
  const offerCodeSpoken = noOffer ? null : settings.offer_code_spoken;
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

  // Outreach starts only AFTER the cart becomes abandoned: the call/WhatsApp
  // clock is anchored at (now + abandonment threshold), then the configured wait
  // runs on top. So first dial = checkout + 10 min + wait_minutes, never before
  // Shopify would even call the cart abandoned.
  const abandonMs = ABANDONMENT_THRESHOLD_MS;
  const voiceWhen = clampToWindow(abandonMs + waitMs);
  // Upper bound on how long the voice track can run before it is exhausted.
  const voiceBudgetMs =
    waitMs + settings.max_attempts * settings.retry_interval_seconds * 1000;
  const waWhen = clampToWindow(abandonMs + (bothRun ? voiceBudgetMs : waitMs));

  const offerFields = {
    offer_label: offerLabel,
    offer_code: offerCode,
    offer_code_spoken: offerCodeSpoken,
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
    // Minted once, here, for the row's whole life: this token is the public
    // short link. Safe on the skipped→active path below (a skipped row was
    // never messaged, so it has no token in circulation), and deliberately
    // absent from the already-active refresh above — rotating a token we've
    // already sent would dead-link a message sitting in someone's WhatsApp.
    short_token: newShortToken(),
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
// SETTLE — an order arrived. Decide what it means for this BUYER's carts.
// =============================================================================
//
// The unit of work here is the BUYER, not the checkout session. Shopify mints a
// new checkout_token every time a shopper re-enters checkout, so one purchase
// decision can leave three or four rows behind — but only ONE order, which can
// only name one of them. Settling per-row (the old two-tier "token match, else
// phone match" with an early return on the token hit) left the siblings open:
// we kept dialling shoppers who had already paid, and credited the young session
// the order happened to name rather than the cart we actually worked.
// =============================================================================

// Last-10-digits key for tolerant phone matching across payload shapes — a
// checkout phone "+91 99620 04406" and an order phone "9962004406" must match.
function phoneKey(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/[^0-9]/g, "");
  if (digits.length === 0) return null;
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

interface CancelCandidate {
  id: string;
  status: string;
  whatsapp_status: string;
  converted_at: string | null;
  phone: string | null;
  created_at: string;
}

// How far back a phone-only match may reach. GoKwik (and any tokenless) orders
// can ONLY be matched by phone, and one buyer may have several open attempts
// (re-abandoned carts). Bounding by time stops an unrelated purchase weeks later
// from being mis-credited to a stale recovery. 3 days comfortably covers the
// outreach window (wait + retries, ~a day) plus a couple days of deliberation.
export const PHONE_ATTRIBUTION_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
// Forward tolerance for clock/timezone skew between the order and our stored
// checkout time — an attempt a little "after" the order is still a match.
const PHONE_ATTRIBUTION_GRACE_MS = 60 * 60 * 1000;

// One of this buyer's carts, as seen when an order lands. Every status is
// included on purpose: a cart can be `failed` (voice gave up) or `canceled` and
// still be the one that did the recovering, because the WhatsApp fallback fires
// precisely when voice gives up. Filtering those out is what made a WhatsApp-led
// recovery impossible to credit.
export interface SettleCandidate {
  id: string;
  status: string;
  created_at: string;
  converted_at: string | null;
  connected_at: string | null;
  whatsapp_sent_at: string | null;
  // The order named this exact cart by checkout_token / cart_token.
  matchedByToken: boolean;
}

export interface SettlementPlan {
  // The single cart to stamp `converted_at` on. null → nothing to credit.
  creditId: string | null;
  match: "token" | "phone" | null;
  outcome: RecoveryOutcome | null;
  // The touch that justifies `recovered_by_us`. Null for the other outcomes.
  firstContactAt: string | null;
  // Live carts (pending/in_flight) to stop outreach on — this buyer has paid, so
  // we must not call them again, not even about a DIFFERENT cart.
  cancelIds: string[];
}

// Decide what an order means for every cart belonging to one buyer. Pure +
// exported so the branch logic is unit-tested without the DB.
//
// Three separate jobs, deliberately not conflated:
//   • STOP outreach on every still-live cart for this buyer (safety).
//   • CREDIT exactly ONE — crediting all would double-count revenue, which sums
//     cart_total across converted rows.
//   • LABEL the conversion by whether we actually reached this buyer FIRST. That
//     label is the recovery metric; cart age alone never answers it.
export function planOrderSettlement(
  candidates: SettleCandidate[],
  orderCreatedAtMs: number,
  windowMs: number,
  abandonmentMs: number,
): SettlementPlan {
  const empty: SettlementPlan = {
    creditId: null,
    match: null,
    outcome: null,
    firstContactAt: null,
    cancelIds: [],
  };

  const inWindow = candidates.filter((c) => {
    const t = Date.parse(c.created_at);
    if (Number.isNaN(t)) return false;
    // Started before the order (± skew grace) and no older than the window.
    return (
      t <= orderCreatedAtMs + PHONE_ATTRIBUTION_GRACE_MS &&
      orderCreatedAtMs - t <= windowMs
    );
  });
  if (inWindow.length === 0) return empty;

  // The evidence: the earliest time we reached this BUYER before they ordered.
  // Buyer-scoped, not cart-scoped — the call may sit on the cart they abandoned
  // while the order names the fresh checkout they came back through.
  let firstContactAt: string | null = null;
  let firstContactMs = Number.POSITIVE_INFINITY;
  for (const c of inWindow) {
    for (const iso of [c.connected_at, c.whatsapp_sent_at]) {
      if (!iso) continue;
      const t = Date.parse(iso);
      if (Number.isNaN(t) || t > orderCreatedAtMs) continue;
      if (orderCreatedAtMs - t > windowMs) continue;
      if (t < firstContactMs) {
        firstContactMs = t;
        firstContactAt = iso;
      }
    }
  }

  const cancelIds = inWindow
    .filter((c) => c.status === "pending" || c.status === "in_flight")
    .map((c) => c.id);

  const creditable = inWindow.filter((c) => !c.converted_at);
  if (creditable.length === 0) return { ...empty, firstContactAt, cancelIds };

  // Prefer the token-matched cart: it IS the cart that became the order, so its
  // cart_total is the order's real value. Then a cart we actually worked, then
  // the most recent — the one closest to the purchase.
  const ranked = [...creditable].sort((a, b) => {
    if (a.matchedByToken !== b.matchedByToken) return a.matchedByToken ? -1 : 1;
    const aTouched = a.connected_at || a.whatsapp_sent_at ? 1 : 0;
    const bTouched = b.connected_at || b.whatsapp_sent_at ? 1 : 0;
    if (aTouched !== bTouched) return bTouched - aTouched;
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  });
  const credit = ranked[0];

  // Contact before the order is the ONLY thing that makes a sale ours. Without
  // it, fall back to whether this buyer's OLDEST cart had genuinely abandoned
  // (past the threshold) or whether they walked straight through checkout.
  const oldestAge = Math.max(
    ...inWindow.map((c) => orderCreatedAtMs - Date.parse(c.created_at)),
  );
  const outcome: RecoveryOutcome = firstContactAt
    ? "recovered_by_us"
    : oldestAge >= abandonmentMs
      ? "recovered_organic"
      : "instant_sale";

  return {
    creditId: credit.id,
    match: credit.matchedByToken ? "token" : "phone",
    outcome,
    firstContactAt,
    cancelIds,
  };
}

// Build the update for a cart we're marking converted (and stopping outreach on
// if it's still live). `match` records HOW we tied the order back — 'token'
// (Shopify attributes the same way) or 'phone' (tokenless GoKwik order).
// `outcome` is the recovery label, stamped here and never re-derived.
// Both are written ONLY when we're NEWLY converting, so a re-delivered webhook
// can't rewrite the original verdict.
export function convertPatch(
  attempt: CancelCandidate,
  now: string,
  settlement: {
    match: "token" | "phone";
    outcome: RecoveryOutcome;
    firstContactAt: string | null;
    // The real order. Written on every settlement (not just the first) so a
    // later orders/updated can correct a total that changed after placement —
    // unlike the verdict, the amount is allowed to be restated.
    orderId?: string | null;
    orderNumber?: string | null;
    orderTotal?: number | null;
    orderCurrency?: string | null;
  },
): Record<string, unknown> {
  const newlyConverting = attempt.converted_at == null;
  const patch: Record<string, unknown> = {
    converted_at: attempt.converted_at ?? now,
  };
  if (newlyConverting) {
    patch.conversion_match = settlement.match;
    patch.recovery_outcome = settlement.outcome;
    patch.first_contact_at = settlement.firstContactAt;
  }
  if (settlement.orderId) patch.order_id = settlement.orderId;
  if (settlement.orderNumber) patch.order_number = settlement.orderNumber;
  if (settlement.orderTotal != null) patch.order_total = settlement.orderTotal;
  if (settlement.orderCurrency) patch.order_currency = settlement.orderCurrency;
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
  return patch;
}

// The columns settlement needs. connected_at / whatsapp_sent_at are the contact
// evidence; without them we cannot tell a recovery from a coincidence.
const SETTLE_COLUMNS =
  "id, status, whatsapp_status, converted_at, phone, created_at, connected_at, whatsapp_sent_at";

// Ceiling on the per-order phone scan. Comfortably above any real store's carts
// in a 3-day window, and explicit so PostgREST's default page size can't silently
// truncate the sweep.
const SETTLE_SCAN_LIMIT = 2000;

interface SettleRow extends CancelCandidate {
  connected_at: string | null;
  whatsapp_sent_at: string | null;
}

export interface OrderSettlementInput {
  organisationId: string;
  checkoutToken: string | null;
  cartToken: string | null;
  phone: string | null;
  orderCreatedAt: string | null;
  // The real order, captured so revenue stops reading the pre-discount cart
  // snapshot and the UI can deep-link to the order in Shopify admin.
  orderId?: string | null;
  orderNumber?: string | null;
  orderTotal?: number | null;
  orderCurrency?: string | null;
}

export async function settleRecoveryForOrder(
  input: OrderSettlementInput,
): Promise<void> {
  const orgId = input.organisationId;
  const admin = createAdminClient();

  const parsed = input.orderCreatedAt ? Date.parse(input.orderCreatedAt) : NaN;
  const orderAtMs = Number.isNaN(parsed) ? Date.now() : parsed;

  const byId = new Map<string, SettleRow>();
  const tokenIds = new Set<string>();

  // 1) Token match — the order names this exact cart. checkout_token is the
  //    classic key; cart_token catches a completion in a different checkout
  //    session (Shop Pay / express), which Shopify itself attributes that way.
  const tokenOr: string[] = [];
  if (input.checkoutToken) {
    tokenOr.push(`checkout_token.eq.${input.checkoutToken}`);
  }
  if (input.cartToken) tokenOr.push(`cart_token.eq.${input.cartToken}`);

  if (tokenOr.length > 0) {
    const { data } = await admin
      .from("shopify_recovery_attempts")
      .select(SETTLE_COLUMNS)
      .eq("organisation_id", orgId)
      .or(tokenOr.join(","))
      .returns<SettleRow[]>();
    for (const r of data ?? []) {
      byId.set(r.id, r);
      tokenIds.add(r.id);
    }
  }

  // 2) The buyer's OTHER carts, by phone. This runs ALWAYS — including after a
  //    token hit, which is the fix. A shopper who re-enters checkout gets a new
  //    row, so the order names the young session while the cart we actually
  //    called sits open under the same phone. Returning early on the token match
  //    left those siblings live: we dialled shoppers who had already paid, and
  //    credited a cart we never worked. It is also the ONLY key for tokenless
  //    (GoKwik) orders, which carry neither token.
  //
  //    No status filter: a `failed` cart (voice gave up) still carries the
  //    WhatsApp send that did the recovering, because the fallback fires exactly
  //    when voice gives up.
  const target = phoneKey(input.phone);
  if (target) {
    const windowStart = new Date(
      orderAtMs - PHONE_ATTRIBUTION_WINDOW_MS,
    ).toISOString();
    // The last-10-digits key can't be expressed in the query builder (stored
    // phones carry country codes and spaces), so we bound hard in SQL — this
    // org, this 3-day window — and match in JS. Newest first with an explicit
    // limit so that if a very busy store ever exceeds it, we keep the carts
    // closest to the purchase rather than truncating arbitrarily.
    const { data } = await admin
      .from("shopify_recovery_attempts")
      .select(SETTLE_COLUMNS)
      .eq("organisation_id", orgId)
      .not("phone", "is", null)
      .gte("created_at", windowStart)
      .order("created_at", { ascending: false })
      .limit(SETTLE_SCAN_LIMIT)
      .returns<SettleRow[]>();
    for (const r of data ?? []) {
      if (phoneKey(r.phone) === target) byId.set(r.id, r);
    }
  }

  if (byId.size === 0) return;

  const plan = planOrderSettlement(
    [...byId.values()].map((r) => ({
      id: r.id,
      status: r.status,
      created_at: r.created_at,
      converted_at: r.converted_at,
      connected_at: r.connected_at,
      whatsapp_sent_at: r.whatsapp_sent_at,
      matchedByToken: tokenIds.has(r.id),
    })),
    orderAtMs,
    PHONE_ATTRIBUTION_WINDOW_MS,
    ABANDONMENT_THRESHOLD_MS,
  );
  if (!plan.creditId && plan.cancelIds.length === 0) return;

  const now = new Date().toISOString();
  const updates: Array<PromiseLike<unknown>> = [];

  if (plan.creditId && plan.match && plan.outcome) {
    const credited = byId.get(plan.creditId)!;
    updates.push(
      admin
        .from("shopify_recovery_attempts")
        .update(
          convertPatch(credited, now, {
            match: plan.match,
            outcome: plan.outcome,
            firstContactAt: plan.firstContactAt,
            orderId: input.orderId ?? null,
            orderNumber: input.orderNumber ?? null,
            orderTotal: input.orderTotal ?? null,
            orderCurrency: input.orderCurrency ?? null,
          }),
        )
        .eq("id", plan.creditId),
    );
    console.log("[shopify recovery] order settled", {
      organisationId: orgId,
      creditedAttempt: plan.creditId,
      match: plan.match,
      outcome: plan.outcome,
      siblingsStopped: plan.cancelIds.filter((id) => id !== plan.creditId).length,
    });
  }

  // Stop outreach on this buyer's OTHER live carts — they bought, so don't call
  // them about a different cart — but do NOT credit them (no double-count).
  for (const id of plan.cancelIds) {
    if (id === plan.creditId) continue;
    const c = byId.get(id)!;
    const patch: Record<string, unknown> = {
      status: "canceled",
      canceled_at: now,
    };
    if (c.whatsapp_status === "pending" || c.whatsapp_status === "in_flight") {
      patch.whatsapp_status = "canceled";
    }
    updates.push(
      admin.from("shopify_recovery_attempts").update(patch).eq("id", id),
    );
  }

  await Promise.all(updates);
}

// =============================================================================
// ORDER LEDGER — make settlement survive a failure.
// =============================================================================
// The webhook 200s Shopify immediately and settles inside next/after(), so a
// transient DB error is invisible to Shopify and never retried: the conversion
// is lost for good and the cart keeps getting dialled. Every order is therefore
// written to shopify_order_events FIRST; the cron tick drains whatever is still
// unprocessed. The unique (organisation_id, order_id) makes redelivery — and
// orders/create followed by orders/paid for the same order — settle exactly once.
// =============================================================================

const ORDER_EVENT_MAX_ATTEMPTS = 5;
const ORDER_EVENT_BATCH = 50;

export interface ShopifyOrderEventInput extends OrderSettlementInput {
  shopDomain: string;
  topic: string;
  orderId: string;
}

async function markSettled(
  admin: Admin,
  eventId: string,
  attempts: number,
  args: OrderSettlementInput,
): Promise<void> {
  try {
    await settleRecoveryForOrder(args);
    await admin
      .from("shopify_order_events")
      .update({
        processed_at: new Date().toISOString(),
        attempts: attempts + 1,
        last_error: null,
      })
      .eq("id", eventId);
  } catch (err) {
    // Leave processed_at null so the tick replays it.
    await admin
      .from("shopify_order_events")
      .update({
        attempts: attempts + 1,
        last_error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      })
      .eq("id", eventId);
    throw err;
  }
}

/**
 * Record an order webhook, then settle it. Idempotent per (org, order): a repeat
 * delivery inserts nothing and returns without re-settling.
 */
export async function recordAndSettleOrder(
  input: ShopifyOrderEventInput,
): Promise<void> {
  const admin = createAdminClient();

  // ON CONFLICT DO NOTHING — .select() returns a row only when WE inserted it.
  const { data: claimed } = await admin
    .from("shopify_order_events")
    .upsert(
      {
        organisation_id: input.organisationId,
        shop_domain: input.shopDomain,
        order_id: input.orderId,
        topic: input.topic,
        checkout_token: input.checkoutToken,
        cart_token: input.cartToken,
        phone: input.phone,
        order_created_at: input.orderCreatedAt,
        order_number: input.orderNumber ?? null,
        order_total: input.orderTotal ?? null,
        order_currency: input.orderCurrency ?? null,
      },
      { onConflict: "organisation_id,order_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle<{ id: string }>();

  // Already seen: either settled, or queued for the tick to retry.
  if (!claimed) return;

  await markSettled(admin, claimed.id, 0, {
    organisationId: input.organisationId,
    checkoutToken: input.checkoutToken,
    cartToken: input.cartToken,
    phone: input.phone,
    orderCreatedAt: input.orderCreatedAt,
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    orderTotal: input.orderTotal,
    orderCurrency: input.orderCurrency,
  });
}

/**
 * Replay orders whose settlement never completed. Runs on every recovery tick,
 * before dispatch — so a cart whose order we just recovered can't be dialled in
 * the same pass.
 */
export async function drainUnsettledOrders(): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("shopify_order_events")
    .select(
      "id, organisation_id, order_id, checkout_token, cart_token, phone, order_created_at, order_number, order_total, order_currency, attempts",
    )
    .is("processed_at", null)
    .lt("attempts", ORDER_EVENT_MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(ORDER_EVENT_BATCH)
    .returns<
      Array<{
        id: string;
        organisation_id: string;
        order_id: string;
        checkout_token: string | null;
        cart_token: string | null;
        phone: string | null;
        order_created_at: string | null;
        order_number: string | null;
        order_total: number | null;
        order_currency: string | null;
        attempts: number;
      }>
    >();

  const pending = data ?? [];
  if (pending.length === 0) return 0;

  let settled = 0;
  for (const e of pending) {
    try {
      await markSettled(admin, e.id, e.attempts, {
        organisationId: e.organisation_id,
        checkoutToken: e.checkout_token,
        cartToken: e.cart_token,
        phone: e.phone,
        orderCreatedAt: e.order_created_at,
        orderId: e.order_id,
        orderNumber: e.order_number,
        orderTotal: e.order_total,
        orderCurrency: e.order_currency,
      });
      settled += 1;
    } catch {
      // markSettled already recorded the error; keep draining the rest.
    }
  }
  if (settled > 0) {
    console.log("[shopify recovery] replayed unsettled orders", { settled });
  }
  return settled;
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
  short_token: string | null;
  cart_items: unknown;
  offer_label: string | null;
  offer_code: string | null;
  offer_code_spoken: string | null;
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
  // Null on rows minted before short links, and on skipped rows (never sent) —
  // buildMessageLink falls back to the long checkout URL.
  short_token: string | null;
  cart_items: unknown;
  offer_label: string | null;
  offer_code: string | null;
  offer_code_spoken: string | null;
  offer_discount_value: number | null;
  offer_discount_kind: string | null;
}

// The storefront's PRIMARY origin/host, derived from the abandoned-checkout URL
// (which always uses the store's primary domain — unlike our stored myshopify
// shop_domain). Used to build the coupon_link template's store name + link.
function storefrontOrigin(recoveryUrl: string | null): string | null {
  if (!recoveryUrl) return null;
  try {
    return new URL(recoveryUrl).origin;
  } catch {
    return null;
  }
}

function storeHost(recoveryUrl: string | null): string {
  const origin = storefrontOrigin(recoveryUrl);
  if (!origin) return "";
  try {
    return new URL(origin).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// The REAL checkout destination. We send the shopper through Shopify's discount
// route so the code is auto-applied, then REDIRECT them to the ORIGINAL
// abandoned-checkout URL — Shopify's durable, cross-device recovery link, whose
// `key` restores the cart server-side with no dependence on the shopper's
// cookies or device. No coupon → just the checkout link (exact cart, no
// discount).
//
// This is what the shopper's browser ultimately lands on, but it is NOT what we
// put in the message: at ~130+ characters of token and percent-encoding it is
// unreadable in WhatsApp. buildRecoveryVariables sends the short link instead
// (buildShortRecoveryLink), and the proxy route calls this to resolve it.
//
// NOTE: completing through this link keeps the checkout_token we stored — but
// an express/Shop Pay checkout started elsewhere will NOT, which is why
// settleRecoveryForOrder also matches on cart_token and phone.
export function buildCheckoutLink(
  recoveryUrl: string | null,
  offerCode: string | null,
): string {
  if (!recoveryUrl) return "";
  if (!offerCode) return recoveryUrl;
  try {
    const u = new URL(recoveryUrl);
    const redirectPath = `${u.pathname}${u.search}`;
    return `${u.origin}/discount/${encodeURIComponent(
      offerCode,
    )}?redirect=${encodeURIComponent(redirectPath)}`;
  } catch {
    return recoveryUrl;
  }
}

// What the coupon_link template actually sends: a short link on the STORE's own
// domain, proxied back to our redirect route. Falls back to the long checkout
// link when the row predates short tokens or the storefront origin is unknown —
// an ugly link still recovers a cart; a missing one doesn't.
function buildMessageLink(
  recoveryUrl: string | null,
  offerCode: string | null,
  shortToken: string | null,
): string {
  const origin = storefrontOrigin(recoveryUrl);
  if (shortToken && origin) return buildShortRecoveryLink(origin, shortToken);
  return buildCheckoutLink(recoveryUrl, offerCode);
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
    // The EXACT redeemable code — what WhatsApp and the checkout link need.
    discount_code: r.offer_code ?? "",
    // How the agent should SAY it ("grab twenty"), because it can't reliably
    // read "GRAB20" aloud. Blank → fall back to the exact code, which is still
    // better than saying nothing. Voice prompts must reference THIS, not
    // {discount_code}; see docs/cart-recovery.md.
    discount_code_spoken: r.offer_code_spoken?.trim() || r.offer_code || "",
    discount_percentage: percentLabel,
    discount_amount: discountAmount != null ? wholeAmount(discountAmount) : "",
    discounted_cart_total:
      discountedTotal != null ? wholeAmount(discountedTotal) : "",
    recovery_url: r.recovery_url ?? "",
    // --- coupon_link WhatsApp template ({{3}} store, {{4}} checkout link) ---
    store_name: storeHost(r.recovery_url),
    discount_link: buildMessageLink(r.recovery_url, r.offer_code, r.short_token),
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

  // Replay any order whose settlement failed BEFORE selecting what to dial —
  // otherwise a shopper whose order we lost gets called again this very tick.
  await drainUnsettledOrders();
  await reconcileStuckRecoveries(admin);

  const { data, error } = await admin
    .from("shopify_recovery_attempts")
    .select(
      "id, organisation_id, lead_id, phone, agent_id, from_phone, attempt, max_attempts, retry_interval_seconds, customer_name, cart_total, currency, recovery_url, short_token, cart_items, offer_label, offer_code, offer_code_spoken, offer_discount_value, offer_discount_kind",
    )
    .eq("status", "pending")
    // Never dial a cart that already converted. settleRecoveryForOrder normally
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

  // Per-lead connected-call cap (global per-org governor). Drop — and record as
  // skipped on BOTH channels — any lead already at the org's ceiling in the
  // rolling 48h window, before we spend a dial. Phone is the cross-surface lead
  // identity (campaign call rows carry no lead_id). A capped cart isn't worth
  // deferring: cart recovery is time-sensitive, so we suppress rather than hold.
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
      cappedRows.flatMap((r) => [
        admin
          .from("shopify_recovery_attempts")
          .update({
            status: "skipped",
            skip_reason: "per_lead_cap_reached",
            last_error: "Per-lead connected-call cap reached (48h)",
          })
          .eq("id", r.id)
          .eq("status", "pending"),
        // Suppress the WhatsApp track too — only if it hasn't already fired.
        admin
          .from("shopify_recovery_attempts")
          .update({
            whatsapp_status: "canceled",
            whatsapp_skip_reason: "per_lead_cap_reached",
          })
          .eq("id", r.id)
          .eq("whatsapp_status", "pending"),
      ]),
    );
  }
  const uncapped = queue.filter(
    (r) => !capEval.isCapped(r.organisation_id, r.phone),
  );
  if (uncapped.length === 0) return { processed: 0, fired: 0 };

  // Calling-window gate: rows whose org is outside its configured dial window
  // are deferred to the next window open (in APP_TIMEZONE) rather than dialled.
  const now = new Date();
  const dialable: DueRecovery[] = [];
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
