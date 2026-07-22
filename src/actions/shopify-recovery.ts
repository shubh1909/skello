"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { logSkeloError } from "@/lib/errors";
import { ShopifyApiError, listDiscountOffers } from "@/lib/shopify/client";
import { getShopifyIntegration } from "@/lib/shopify/integration";
import { ABANDONMENT_THRESHOLD_MINUTES } from "@/lib/shopify/recovery";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionResult, fail, ok } from "@/types/action";
import type {
  RecoveryAttemptRow,
  RecoveryCallRow,
  RecoveryCartItem,
  RecoveryMessageRow,
  RecoveryMessageStatus,
  RecoveryMetrics,
  RecoveryOutcome,
  RecoveryPage,
  RecoveryVoiceAgent,
  RecoveryWhatsAppStatus,
  ShopifyOfferOption,
  ShopifyRecoverySettings,
} from "@/types/shopify";

export interface RecoveryOverview {
  connected: boolean;
  settings: ShopifyRecoverySettings | null;
  metrics: RecoveryMetrics;
  voiceAgent: RecoveryVoiceAgent | null;
  whatsApp: RecoveryWhatsAppStatus | null;
}

const SETTINGS_COLUMNS =
  "organisation_id, enabled, wait_minutes, max_attempts, retry_interval_seconds, agent_id, offer_type, offer_code, offer_code_spoken, offer_label, offer_discount_value, offer_discount_kind, call_window_start, call_window_end, voice_enabled, whatsapp_enabled, whatsapp_template_name, whatsapp_template_layout, created_at, updated_at";

const ATTEMPT_COLUMNS =
  "id, status, skip_reason, customer_name, email, phone, marketing_consent, cart_total, currency, cart_items, offer_label, offer_code, offer_code_spoken, attempt, max_attempts, last_status, created_at, abandoned_at, scheduled_at, next_attempt_at, canceled_at, converted_at, whatsapp_status, whatsapp_sent_at, whatsapp_next_at, whatsapp_skip_reason, whatsapp_error, clicked_at, conversion_match, recovery_outcome, first_contact_at";

const MESSAGE_COLUMNS =
  "id, to_phone, template_name, provider, provider_message_id, status, error_message, error_code, sent_at, delivered_at, read_at, created_at";

const CALL_COLUMNS =
  "id, status, direction, to_phone, from_phone, error_message, bolna_call_id, created_at, started_at, answered_at, ended_at, duration_seconds, recording_url, transcript, transcript_url, summary, name_extracted, interest, lead_intent_extracted, customer_status, call_outcome, requested_callback_at, connect_on_whatsapp, visit_scheduled_at, lead_data, custom_data, shopify_recovery_attempt_id, lead_id";

const PAGE_SIZE = 20;

// Meta's delivery signal (delivered/read/failed) lives on
// shopify_recovery_messages — the ATTEMPT only tracks our own send track
// (whatsapp_status), which says nothing about whether the message landed. To
// show both sides in the cart table we derive the furthest state each listed
// cart reached, batched into ONE query for the page rather than N.
const DELIVERY_RANK: Record<RecoveryMessageStatus, number> = {
  failed: 0,
  queued: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};

async function attachDeliveryState<T extends { id: string }>(
  admin: ReturnType<typeof createAdminClient>,
  organisationId: string,
  rows: T[],
): Promise<Array<T & { whatsapp_delivery: RecoveryMessageStatus | null }>> {
  if (rows.length === 0) return [];

  const { data } = await admin
    .from("shopify_recovery_messages")
    .select("shopify_recovery_attempt_id, status")
    .eq("organisation_id", organisationId)
    .in(
      "shopify_recovery_attempt_id",
      rows.map((r) => r.id),
    )
    .returns<
      {
        shopify_recovery_attempt_id: string | null;
        status: RecoveryMessageStatus;
      }[]
    >();

  // Furthest, not latest: when a retry lands after an earlier failure, the cart
  // WAS reached — the failure is history, so 'delivered' outranks 'failed'.
  const furthest = new Map<string, RecoveryMessageStatus>();
  for (const m of data ?? []) {
    const key = m.shopify_recovery_attempt_id;
    if (!key) continue;
    const current = furthest.get(key);
    if (
      !current ||
      (DELIVERY_RANK[m.status] ?? 0) > (DELIVERY_RANK[current] ?? 0)
    ) {
      furthest.set(key, m.status);
    }
  }

  return rows.map((r) => ({
    ...r,
    whatsapp_delivery: furthest.get(r.id) ?? null,
  }));
}

// NOTE: attribution is no longer computed here. It used to be a third, separate
// definition of "recovered" (a completed call that ended before converted_at),
// which disagreed with both `converted_at` and the old `is_recovery` column and
// ignored WhatsApp entirely. It is now stamped once at settlement as
// `recovery_outcome` — see lib/shopify/recovery.ts → planOrderSettlement.

// Dashboard read — settings + headline metrics + recent activity. Org-scoped to
// the caller's own workspace (resolved from the session, never the client).
export async function getRecoveryOverview(): Promise<
  ActionResult<RecoveryOverview>
> {
  const session = await requireSession();
  const orgId = session.organisation.id;
  const admin = createAdminClient();

  const [
    integrationRes,
    settingsRes,
    bolnaRes,
    whatsappRes,
    callsMadeRes,
    convertedRes,
  ] = await Promise.all([
    admin
      .from("shopify_integrations")
      .select("access_token, enabled")
      .eq("organisation_id", orgId)
      .maybeSingle<{ access_token: string | null; enabled: boolean }>(),
    admin
      .from("shopify_recovery_settings")
      .select(SETTINGS_COLUMNS)
      .eq("organisation_id", orgId)
      .maybeSingle<ShopifyRecoverySettings>(),
    // Voice-agent wiring for the read-only card (caller number + default agent).
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
    // WhatsApp wiring for the read-only card.
    admin
      .from("whatsapp_integrations")
      .select("sender_id, template_name, enabled")
      .eq("organisation_id", orgId)
      .maybeSingle<{
        sender_id: string | null;
        template_name: string | null;
        enabled: boolean;
      }>(),
    admin
      .from("shopify_recovery_attempts")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", orgId)
      .gt("attempt", 0),
    // Every settled conversion, with its stamped verdict. Splitting happens in
    // memory below — one query, one definition, no re-derivation.
    admin
      .from("shopify_recovery_attempts")
      .select(
        "id, cart_total, currency, converted_at, recovery_outcome, order_total, order_currency",
      )
      .eq("organisation_id", orgId)
      .not("converted_at", "is", null)
      .limit(5000)
      .returns<
        Array<{
          id: string;
          cart_total: number | null;
          currency: string | null;
          converted_at: string | null;
          recovery_outcome: RecoveryOutcome | null;
          order_total: number | null;
          order_currency: string | null;
        }>
      >(),
  ]);

  const converted = convertedRes.data ?? [];
  // What the shopper ACTUALLY paid. cart_total is the pre-discount snapshot at
  // abandonment — with a discount offer running it overstates every recovery.
  // Fall back to it only for rows settled before we captured the order.
  const realValue = (r: { order_total: number | null; cart_total: number | null }) =>
    r.order_total ?? r.cart_total ?? 0;

  // DISPLAYED: every cart that genuinely abandoned and then came back, whatever
  // brought it back — us, GoKwik, or the shopper's own return. Instant sales are
  // excluded (they never abandoned).
  const recovered = converted.filter(
    (r) =>
      r.recovery_outcome === "recovered_by_us" ||
      r.recovery_outcome === "recovered_organic",
  );
  // INTERNAL: the provable subset. Not rendered, but carried so ROI stays
  // answerable — see RecoveryMetrics.
  const ours = converted.filter((r) => r.recovery_outcome === "recovered_by_us");

  // Resolve the voice agent recovery dials from: the recovery override, else the
  // org's default agent. Its friendly name comes from the voice_agents registry.
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
  // The caller-ID: the org's configured default/pool if set, else the number
  // actually used on the most recent recovery dial (backfilled from the provider
  // on call completion — the number often lives only on the agent config).
  let callerNumber =
    bolna?.from_phone_number?.trim() || bolna?.from_phone_numbers?.[0] || null;
  if (!callerNumber) {
    const { data: lastCall } = await admin
      .from("calls")
      .select("from_phone")
      .eq("organisation_id", orgId)
      .not("shopify_recovery_attempt_id", "is", null)
      .not("from_phone", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ from_phone: string | null }>();
    callerNumber = lastCall?.from_phone ?? null;
  }
  const voiceAgent: RecoveryVoiceAgent = {
    name: agentName,
    callerNumber,
    configured: Boolean(effectiveAgentId && bolna?.enabled),
  };

  // WhatsApp channel status for the read-only card. A template (settings override
  // or integration default) is required before anything can send.
  const waRow = whatsappRes.data;
  const waTemplate =
    settingsRes.data?.whatsapp_template_name?.trim() ||
    waRow?.template_name?.trim() ||
    null;
  const whatsApp: RecoveryWhatsAppStatus = {
    configured: Boolean(waRow?.enabled && waTemplate),
    enabled: settingsRes.data?.whatsapp_enabled ?? false,
    sender: waRow?.sender_id ?? null,
    templateName: waTemplate,
  };

  // "Carts abandoned" — OPEN abandoned carts only, gated to match Shopify's
  // ~10-min abandonment threshold so the number reconciles instead of counting
  // every checkout:
  //   • has contact info  — we only act on carts with a phone
  //   • past the abandonment window — a checkout inside the first 10 min isn't
  //     abandoned yet (Shopify wouldn't count it)
  //   • not converted — a bought cart is either a recovery (its own tile) or an
  //     instant sale (never abandoned); neither belongs in "open abandoned"
  // Excludes `skipped` (no phone / no channel — never actioned).
  const abandonedCutoff = new Date(
    Date.now() - ABANDONMENT_THRESHOLD_MINUTES * 60_000,
  ).toISOString();
  const abandonedRes = await admin
    .from("shopify_recovery_attempts")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", orgId)
    .neq("status", "skipped")
    .not("phone", "is", null)
    .is("converted_at", null)
    .lte("created_at", abandonedCutoff);

  const metrics: RecoveryMetrics = {
    abandoned: abandonedRes.count ?? 0,
    calls_made: callsMadeRes.count ?? 0,
    recovered: recovered.length,
    revenue_recovered: recovered.reduce((s, r) => s + realValue(r), 0),
    recovered_by_us: ours.length,
    revenue_by_us: ours.reduce((s, r) => s + realValue(r), 0),
    conversions_total: converted.length,
    currency:
      converted.find((r) => r.order_currency)?.order_currency ??
      converted.find((r) => r.currency)?.currency ??
      null,
  };

  return ok({
    connected: Boolean(
      integrationRes.data?.access_token && integrationRes.data?.enabled,
    ),
    settings: settingsRes.data ?? null,
    metrics,
    voiceAgent,
    whatsApp,
  });
}

// Cheap flag for the sidebar: is cart recovery switched on for this org? Used to
// reveal the Cart Recovery sub-item only when the feature is live. Returns false
// on any error (fail closed — hide the nav item rather than break the layout).
export async function isCartRecoveryActive(): Promise<boolean> {
  try {
    const session = await requireSession();
    const admin = createAdminClient();
    const { data } = await admin
      .from("shopify_recovery_settings")
      .select("enabled")
      .eq("organisation_id", session.organisation.id)
      .maybeSingle<{ enabled: boolean }>();
    return data?.enabled ?? false;
  } catch {
    return false;
  }
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  wait_minutes: z.number().int().min(1).max(1440),
  max_attempts: z.number().int().min(1).max(10),
  retry_interval_seconds: z.number().int().min(60).max(86400),
  offer_type: z.enum(["none", "discount_code", "free_product"]),
  offer_code: z.string().trim().max(120).nullable().optional(),
  offer_code_spoken: z.string().trim().max(200).nullable().optional(),
  offer_label: z.string().trim().max(200).nullable().optional(),
  // Numeric discount captured from the chosen Shopify price rule. Optional —
  // a manually-typed offer label has no matching rule, so the agent just
  // quotes the cart total without a discounted figure.
  offer_discount_value: z.number().min(0).nullable().optional(),
  offer_discount_kind: z.enum(["percentage", "fixed_amount"]).nullable().optional(),
  // Daily calling window (IST). "HH:MM" from the UI; both null → no restriction.
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
  // Channels. Optional so older callers/forms stay valid; defaults reproduce
  // voice-only behaviour.
  voice_enabled: z.boolean().optional(),
  whatsapp_enabled: z.boolean().optional(),
  whatsapp_template_name: z.string().trim().max(200).nullable().optional(),
  whatsapp_template_layout: z.enum(["classic", "coupon_link"]).optional(),
});

// The org tunes its own offer + timing. Org resolved from the session; the
// service-role client performs the write (the settings table has owner-read
// RLS but no owner-write policy).
export async function saveRecoverySettings(
  input: unknown,
): Promise<ActionResult<ShopifyRecoverySettings>> {
  const session = await requireSession();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("shopify_recovery_settings")
    .upsert(
      {
        organisation_id: session.organisation.id,
        enabled: parsed.data.enabled,
        wait_minutes: parsed.data.wait_minutes,
        max_attempts: parsed.data.max_attempts,
        retry_interval_seconds: parsed.data.retry_interval_seconds,
        offer_type: parsed.data.offer_type,
        offer_code: parsed.data.offer_code ?? null,
        offer_code_spoken: parsed.data.offer_code_spoken ?? null,
        offer_label: parsed.data.offer_label ?? null,
        // Drop the numeric discount when there's no offer.
        offer_discount_value:
          parsed.data.offer_type === "none"
            ? null
            : parsed.data.offer_discount_value ?? null,
        offer_discount_kind:
          parsed.data.offer_type === "none"
            ? null
            : parsed.data.offer_discount_kind ?? null,
        // Window is both-or-neither: a partial range means "no restriction".
        call_window_start:
          parsed.data.call_window_start && parsed.data.call_window_end
            ? parsed.data.call_window_start
            : null,
        call_window_end:
          parsed.data.call_window_start && parsed.data.call_window_end
            ? parsed.data.call_window_end
            : null,
        // Channels — only write when provided so a legacy form save doesn't
        // clobber the org's channel config.
        ...(parsed.data.voice_enabled !== undefined
          ? { voice_enabled: parsed.data.voice_enabled }
          : {}),
        ...(parsed.data.whatsapp_enabled !== undefined
          ? { whatsapp_enabled: parsed.data.whatsapp_enabled }
          : {}),
        ...(parsed.data.whatsapp_template_name !== undefined
          ? { whatsapp_template_name: parsed.data.whatsapp_template_name }
          : {}),
        ...(parsed.data.whatsapp_template_layout !== undefined
          ? { whatsapp_template_layout: parsed.data.whatsapp_template_layout }
          : {}),
      },
      { onConflict: "organisation_id" },
    )
    .select(SETTINGS_COLUMNS)
    .single<ShopifyRecoverySettings>();

  if (error) {
    return fail(
      logSkeloError("SHOPIFY", "Failed to save recovery settings", {
        organisationId: session.organisation.id,
        cause: error,
      }),
    );
  }

  revalidatePath("/campaigns/templates/cart-recovery");
  return ok(data);
}

// Pull the store's discount campaigns so the org can pick an offer. Best-effort;
// returns a clear error if the store isn't connected.
export async function listShopifyOffers(): Promise<
  ActionResult<ShopifyOfferOption[]>
> {
  const session = await requireSession();
  const integration = await getShopifyIntegration(session.organisation.id);
  if (!integration || !integration.access_token) {
    return fail("Shopify isn't connected for this workspace yet.");
  }

  try {
    const offers = await listDiscountOffers({
      shopDomain: integration.shop_domain,
      accessToken: integration.access_token,
      apiVersion: integration.api_version,
    });
    return ok(offers);
  } catch (err) {
    if (err instanceof ShopifyApiError) {
      return fail(`Couldn't load offers from Shopify: ${err.message}`);
    }
    return fail(
      logSkeloError("SHOPIFY", "Failed to list Shopify offers", {
        organisationId: session.organisation.id,
        cause: err,
      }),
    );
  }
}

// =============================================================================
// CAMPAIGN CONTROLS — start / resume / stop the always-on recovery engine.
//   "running" is the org's shopify_recovery_settings.enabled flag. Stopping also
//   cancels queued (pending) attempts so nothing further dials; in-flight calls
//   are left to finish. Start/Resume are the same enable — the label differs by
//   whether the org has prior activity.
// =============================================================================

export async function setRecoveryRunning(
  running: unknown,
): Promise<ActionResult<{ running: boolean }>> {
  const session = await requireSession();
  const parsed = z.boolean().safeParse(running);
  if (!parsed.success) return fail("Invalid request");

  const orgId = session.organisation.id;
  const admin = createAdminClient();

  // Upsert the flag only — the table's column defaults backfill a first-time row
  // without clobbering offer/timing on an existing one.
  const { error } = await admin
    .from("shopify_recovery_settings")
    .upsert(
      { organisation_id: orgId, enabled: parsed.data },
      { onConflict: "organisation_id" },
    );
  if (error) {
    return fail(
      logSkeloError("SHOPIFY", "Failed to toggle recovery", {
        organisationId: orgId,
        cause: error,
      }),
    );
  }

  // Hard stop: cancel everything still queued so the cron tick won't dial it.
  if (!parsed.data) {
    const nowIso = new Date().toISOString();
    await admin
      .from("shopify_recovery_attempts")
      .update({ status: "canceled", canceled_at: nowIso })
      .eq("organisation_id", orgId)
      .eq("status", "pending");
    // Same hard stop for the WhatsApp track.
    await admin
      .from("shopify_recovery_attempts")
      .update({ whatsapp_status: "canceled", whatsapp_next_at: null })
      .eq("organisation_id", orgId)
      .eq("whatsapp_status", "pending");
  }

  revalidatePath("/campaigns/templates/cart-recovery");
  return ok({ running: parsed.data });
}

// Manual bulk send — queue the WhatsApp template for every eligible cart so the
// next cron tick sends it (reuses the drainer's concurrency/retry/window). Only
// queues carts that aren't converted, have a phone, and whose WhatsApp track is
// idle (none / previously skipped / failed). Requires WhatsApp enabled + a
// connected integration + an approved template.
const BULK_WHATSAPP_LIMIT = 2000;

export async function sendWhatsAppToAbandonedCarts(): Promise<
  ActionResult<{ queued: number }>
> {
  const session = await requireSession();
  const orgId = session.organisation.id;
  const admin = createAdminClient();

  const [{ data: settings }, { data: integration }] = await Promise.all([
    admin
      .from("shopify_recovery_settings")
      .select("whatsapp_enabled, whatsapp_template_name")
      .eq("organisation_id", orgId)
      .maybeSingle<{
        whatsapp_enabled: boolean;
        whatsapp_template_name: string | null;
      }>(),
    admin
      .from("whatsapp_integrations")
      .select("template_name, enabled")
      .eq("organisation_id", orgId)
      .maybeSingle<{ template_name: string | null; enabled: boolean }>(),
  ]);

  if (!settings?.whatsapp_enabled) {
    return fail("WhatsApp isn't enabled for cart recovery.");
  }
  if (!integration?.enabled) {
    return fail("WhatsApp isn't connected for this workspace yet.");
  }
  const template =
    settings.whatsapp_template_name?.trim() ||
    integration.template_name?.trim() ||
    null;
  if (!template) {
    return fail("No approved WhatsApp template is set yet.");
  }

  // Bounded select then queue — avoids an unbounded UPDATE.
  const { data: rows, error } = await admin
    .from("shopify_recovery_attempts")
    .select("id")
    .eq("organisation_id", orgId)
    .is("converted_at", null)
    .not("phone", "is", null)
    .in("whatsapp_status", ["none", "skipped", "failed"])
    .limit(BULK_WHATSAPP_LIMIT)
    .returns<Array<{ id: string }>>();
  if (error) {
    return fail(
      logSkeloError("SHOPIFY", "Failed to select carts for WhatsApp", {
        organisationId: orgId,
        cause: error,
      }),
    );
  }
  const ids = (rows ?? []).map((r) => r.id);
  if (ids.length === 0) return ok({ queued: 0 });

  const nowIso = new Date().toISOString();
  const { error: upErr } = await admin
    .from("shopify_recovery_attempts")
    .update({
      whatsapp_status: "pending",
      whatsapp_next_at: nowIso,
      whatsapp_attempt: 0,
      whatsapp_skip_reason: null,
    })
    .in("id", ids);
  if (upErr) {
    return fail(
      logSkeloError("SHOPIFY", "Failed to queue WhatsApp sends", {
        organisationId: orgId,
        cause: upErr,
      }),
    );
  }

  revalidatePath("/campaigns/templates/cart-recovery");
  return ok({ queued: ids.length });
}

// WhatsApp message history for one cart (mirrors getRecoveryCallsForAttempt) —
// powers the timeline in the cart detail drawer.
export async function getRecoveryMessagesForAttempt(
  attemptId: unknown,
): Promise<ActionResult<RecoveryMessageRow[]>> {
  const session = await requireSession();
  const parsed = z.string().uuid().safeParse(attemptId);
  if (!parsed.success) return fail("Invalid request");
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("shopify_recovery_messages")
    .select(MESSAGE_COLUMNS)
    .eq("organisation_id", session.organisation.id)
    .eq("shopify_recovery_attempt_id", parsed.data)
    .order("created_at", { ascending: true })
    .returns<RecoveryMessageRow[]>();

  if (error) {
    return fail(
      logSkeloError("SHOPIFY", "Failed to load cart WhatsApp messages", {
        organisationId: session.organisation.id,
        cause: error,
      }),
    );
  }
  return ok(data ?? []);
}

// CSV export of the org's recovery activity. Bounded (keyset would be overkill
// for an export button); 5k rows covers any realistic store and stays safe.
const EXPORT_LIMIT = 5000;

interface ExportRow {
  created_at: string;
  customer_name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  skip_reason: string | null;
  cart_total: number | null;
  currency: string | null;
  offer_label: string | null;
  offer_code: string | null;
  attempt: number;
  converted_at: string | null;
  recovery_outcome: RecoveryOutcome | null;
  whatsapp_status: string | null;
  whatsapp_sent_at: string | null;
  connected_at: string | null;
  clicked_at: string | null;
  order_number: string | null;
  order_total: number | null;
  order_currency: string | null;
}

// RFC-4180-ish field escaping: wrap in quotes when the value holds a comma,
// quote, or newline; double any embedded quotes.
function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportRecoveryAttempts(): Promise<
  ActionResult<{ csv: string; filename: string }>
> {
  const session = await requireSession();
  const orgId = session.organisation.id;
  const admin = createAdminClient();

  // The export used to carry neither the outcome nor the order, so a reader had
  // only `converted_at` and a `status` column that means the VOICE track — a
  // recovered cart reads "canceled" there, because we stop outreach when the
  // order lands. Filtering on it made recoveries look like a handful.
  const { data, error } = await admin
    .from("shopify_recovery_attempts")
    .select(
      "created_at, customer_name, email, phone, status, skip_reason, cart_total, currency, offer_label, offer_code, attempt, converted_at, recovery_outcome, whatsapp_status, whatsapp_sent_at, connected_at, clicked_at, order_number, order_total, order_currency",
    )
    .eq("organisation_id", orgId)
    .order("created_at", { ascending: false })
    .limit(EXPORT_LIMIT)
    .returns<ExportRow[]>();

  if (error) {
    return fail(
      logSkeloError("SHOPIFY", "Failed to export recovery attempts", {
        organisationId: orgId,
        cause: error,
      }),
    );
  }

  // "Cart outcome" is the column a reader actually wants: Recovered / Bought -
  // not abandoned / Open. It mirrors the badge in the UI, so it does NOT split
  // recovered carts by which channel brought them back.
  const cartOutcome = (r: ExportRow): string => {
    if (!r.converted_at) return "Open";
    if (r.recovery_outcome === "instant_sale") return "Bought - not abandoned";
    return "Recovered";
  };

  const header = [
    "Created",
    "Shopper",
    "Email",
    "Phone",
    "Cart outcome",
    "Voice status",
    "Skip reason",
    "Cart total",
    "Currency",
    "Offer",
    "Discount code",
    "Call attempts",
    "Call connected at",
    "WhatsApp status",
    "WhatsApp sent at",
    "Link clicked at",
    "Converted at",
    "Order",
    "Order total",
    "Order currency",
  ];
  const rows = (data ?? []).map((r) =>
    [
      r.created_at,
      r.customer_name,
      r.email,
      r.phone,
      cartOutcome(r),
      r.status,
      r.skip_reason,
      r.cart_total,
      r.currency,
      r.offer_label,
      r.offer_code,
      r.attempt,
      r.connected_at,
      r.whatsapp_status,
      r.whatsapp_sent_at,
      r.clicked_at,
      r.converted_at,
      r.order_number,
      r.order_total,
      r.order_currency,
    ]
      .map(csvField)
      .join(","),
  );
  const csv = [header.map(csvField).join(","), ...rows].join("\r\n");

  return ok({ csv, filename: "cart-recovery.csv" });
}

// =============================================================================
// TAB DATA — paginated feeds for the recovery workspace (abandoned / converted
// / call history). Each returns one page + a total count for the pager.
// =============================================================================

const pageInput = z.object({
  page: z.number().int().min(0).max(100000).optional(),
  // Abandoned/carts tab only — sort direction on the abandoned timestamp.
  sort: z.enum(["asc", "desc"]).optional(),
});

function pageRange(page: number): [number, number] {
  const from = page * PAGE_SIZE;
  return [from, from + PAGE_SIZE - 1];
}

// The carts view — every *callable* cart we recorded (has a phone, not skipped),
// converted or not, so the table can show each one's outcome (still abandoned /
// recovered by us / recovered organically). Non-callable carts (no phone / no
// voice agent) are intentionally excluded here; they're still counted in the
// dashboard stats.
export async function getAbandonedCarts(
  input: unknown,
): Promise<ActionResult<RecoveryPage<RecoveryAttemptRow>>> {
  const session = await requireSession();
  const parsed = pageInput.safeParse(input ?? {});
  if (!parsed.success) return fail("Invalid request");
  const page = parsed.data.page ?? 0;
  const admin = createAdminClient();

  // Sort on the abandoned timestamp the column displays (abandoned_at, falling
  // back to created_at for rows without Shopify's checkout time). Default newest
  // first. created_at is the stable tiebreaker.
  // OPEN abandoned carts: past the ~10-min abandonment window with no order yet.
  // A checkout still inside the window isn't abandoned (a fast checkout in
  // progress), and a converted cart is either a recovery or an instant sale —
  // neither is an "open abandoned cart". This is what stopped normal purchases
  // (e.g. a checkout that paid within a minute) from showing here.
  const ascending = parsed.data.sort === "asc";
  const abandonedCutoff = new Date(
    Date.now() - ABANDONMENT_THRESHOLD_MINUTES * 60_000,
  ).toISOString();
  const query = admin
    .from("shopify_recovery_attempts")
    .select(ATTEMPT_COLUMNS, { count: "exact" })
    .eq("organisation_id", session.organisation.id)
    .neq("status", "skipped")
    .not("phone", "is", null)
    .is("converted_at", null)
    .lte("created_at", abandonedCutoff);

  const [from, to] = pageRange(page);
  const { data, count, error } = await query
    .order("abandoned_at", { ascending, nullsFirst: false })
    .order("created_at", { ascending })
    .range(from, to)
    .returns<RecoveryAttemptRow[]>();

  if (error) {
    return fail(
      logSkeloError("SHOPIFY", "Failed to load abandoned carts", {
        organisationId: session.organisation.id,
        cause: error,
      }),
    );
  }

  // The cart-status column reads recovery_outcome straight off the row — no
  // second query and no re-derivation.
  const rows = data ?? [];
  const withDelivery = await attachDeliveryState(
    admin,
    session.organisation.id,
    rows,
  );
  return ok({ rows: withDelivery, total: count ?? 0 });
}

// The Recovered tab: carts that genuinely abandoned and then converted, whether
// we drove it (recovered_by_us) or the shopper returned on their own
// (recovered_organic). Instant sales are excluded — they never abandoned, so
// they were never ours to recover, and showing them here is what made this tab
// look like "every order that passed through checkout".
export async function getConvertedCarts(
  input: unknown,
): Promise<ActionResult<RecoveryPage<RecoveryAttemptRow>>> {
  const session = await requireSession();
  const parsed = pageInput.safeParse(input ?? {});
  if (!parsed.success) return fail("Invalid request");
  const page = parsed.data.page ?? 0;
  const admin = createAdminClient();

  const [from, to] = pageRange(page);
  const { data, count, error } = await admin
    .from("shopify_recovery_attempts")
    .select(ATTEMPT_COLUMNS, { count: "exact" })
    .eq("organisation_id", session.organisation.id)
    .in("recovery_outcome", ["recovered_by_us", "recovered_organic"])
    .order("converted_at", { ascending: false })
    .range(from, to)
    .returns<RecoveryAttemptRow[]>();

  if (error) {
    return fail(
      logSkeloError("SHOPIFY", "Failed to load converted carts", {
        organisationId: session.organisation.id,
        cause: error,
      }),
    );
  }

  const withDelivery = await attachDeliveryState(
    admin,
    session.organisation.id,
    data ?? [],
  );
  return ok({ rows: withDelivery, total: count ?? 0 });
}

interface RawCallRow {
  id: string;
  status: string;
  direction: string;
  to_phone: string | null;
  from_phone: string | null;
  error_message: string | null;
  bolna_call_id: string | null;
  created_at: string;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  transcript: string | null;
  transcript_url: string | null;
  summary: string | null;
  name_extracted: string | null;
  interest: string | null;
  lead_intent_extracted: string | null;
  customer_status: string | null;
  call_outcome: string | null;
  requested_callback_at: string | null;
  connect_on_whatsapp: boolean | null;
  visit_scheduled_at: string | null;
  lead_data: Record<string, unknown> | null;
  custom_data: Record<string, unknown> | null;
  shopify_recovery_attempt_id: string | null;
  lead_id: string | null;
}

// Call history for recovery dials, joined to the cart snapshot + the lead's
// current view. One row per call (retries show as separate rows).
export async function getRecoveryCalls(
  input: unknown,
): Promise<ActionResult<RecoveryPage<RecoveryCallRow>>> {
  const session = await requireSession();
  const parsed = pageInput.safeParse(input ?? {});
  if (!parsed.success) return fail("Invalid request");
  const page = parsed.data.page ?? 0;
  const admin = createAdminClient();

  const [from, to] = pageRange(page);
  const { data, count, error } = await admin
    .from("calls")
    .select(CALL_COLUMNS, { count: "exact" })
    .eq("organisation_id", session.organisation.id)
    .not("shopify_recovery_attempt_id", "is", null)
    .order("created_at", { ascending: false })
    .range(from, to)
    .returns<RawCallRow[]>();

  if (error) {
    return fail(
      logSkeloError("SHOPIFY", "Failed to load recovery calls", {
        organisationId: session.organisation.id,
        cause: error,
      }),
    );
  }

  const rows = await enrichRecoveryCalls(admin, data ?? []);
  return ok({ rows, total: count ?? 0 });
}

// Enrich raw call rows with each call's cart snapshot + the lead's current view.
// Neither relationship is embedded (calls.shopify_recovery_attempt_id has no FK,
// and embedding leads proved brittle across schema caches), so we fetch both by
// id. Shared by the paged call-history tab and the per-cart call history.
async function enrichRecoveryCalls(
  admin: ReturnType<typeof createAdminClient>,
  calls: RawCallRow[],
): Promise<RecoveryCallRow[]> {
  const attemptIds = Array.from(
    new Set(
      calls
        .map((c) => c.shopify_recovery_attempt_id)
        .filter((id): id is string => !!id),
    ),
  );
  const leadIds = Array.from(
    new Set(calls.map((c) => c.lead_id).filter((id): id is string => !!id)),
  );

  const attemptById = new Map<
    string,
    {
      cart_total: number | null;
      currency: string | null;
      cart_items: RecoveryCartItem[];
      customer_name: string | null;
    }
  >();
  const leadById = new Map<
    string,
    { name: string | null; status: string | null; lead_intent: string | null }
  >();

  const [attsRes, leadsRes] = await Promise.all([
    attemptIds.length > 0
      ? admin
          .from("shopify_recovery_attempts")
          .select("id, cart_total, currency, cart_items, customer_name")
          .in("id", attemptIds)
          .returns<
            Array<{
              id: string;
              cart_total: number | null;
              currency: string | null;
              cart_items: RecoveryCartItem[];
              customer_name: string | null;
            }>
          >()
      : Promise.resolve({ data: [] as never[] }),
    leadIds.length > 0
      ? admin
          .from("leads")
          .select("id, name, status, lead_intent")
          .in("id", leadIds)
          .returns<
            Array<{
              id: string;
              name: string | null;
              status: string | null;
              lead_intent: string | null;
            }>
          >()
      : Promise.resolve({ data: [] as never[] }),
  ]);

  for (const a of attsRes.data ?? []) {
    attemptById.set(a.id, {
      cart_total: a.cart_total,
      currency: a.currency,
      cart_items: Array.isArray(a.cart_items) ? a.cart_items : [],
      customer_name: a.customer_name,
    });
  }
  for (const l of leadsRes.data ?? []) {
    leadById.set(l.id, {
      name: l.name,
      status: l.status,
      lead_intent: l.lead_intent,
    });
  }

  return calls.map((c) => {
    const att = c.shopify_recovery_attempt_id
      ? attemptById.get(c.shopify_recovery_attempt_id)
      : undefined;
    const lead = c.lead_id ? leadById.get(c.lead_id) : undefined;
    return {
      id: c.id,
      status: c.status,
      direction: c.direction,
      to_phone: c.to_phone,
      from_phone: c.from_phone,
      error_message: c.error_message,
      bolna_call_id: c.bolna_call_id,
      created_at: c.created_at,
      started_at: c.started_at,
      answered_at: c.answered_at,
      ended_at: c.ended_at,
      duration_seconds: c.duration_seconds,
      recording_url: c.recording_url,
      transcript: c.transcript,
      transcript_url: c.transcript_url,
      summary: c.summary,
      name_extracted: c.name_extracted,
      interest: c.interest,
      lead_intent_extracted: c.lead_intent_extracted,
      customer_status: c.customer_status,
      call_outcome: c.call_outcome,
      requested_callback_at: c.requested_callback_at,
      connect_on_whatsapp: c.connect_on_whatsapp,
      visit_scheduled_at: c.visit_scheduled_at,
      lead_data: c.lead_data,
      custom_data: c.custom_data,
      cart_total: att?.cart_total ?? null,
      currency: att?.currency ?? null,
      cart_items: att?.cart_items ?? [],
      customer_name: att?.customer_name ?? null,
      lead_name: lead?.name ?? null,
      lead_status: lead?.status ?? null,
      lead_intent: lead?.lead_intent ?? null,
    };
  });
}

// Every recovery call for one cart (attempt), chronological. Powers the call
// history shown inside the cart detail drawer. Bounded by max_attempts, so no
// pagination. Org-scoped from the session, and the attempt is verified to belong
// to the caller's org before its calls are returned.
export async function getRecoveryCallsForAttempt(
  attemptId: unknown,
): Promise<ActionResult<RecoveryCallRow[]>> {
  const session = await requireSession();
  const parsed = z.string().uuid().safeParse(attemptId);
  if (!parsed.success) return fail("Invalid request");
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("calls")
    .select(CALL_COLUMNS)
    .eq("organisation_id", session.organisation.id)
    .eq("shopify_recovery_attempt_id", parsed.data)
    .order("created_at", { ascending: true })
    .returns<RawCallRow[]>();

  if (error) {
    return fail(
      logSkeloError("SHOPIFY", "Failed to load cart call history", {
        organisationId: session.organisation.id,
        cause: error,
      }),
    );
  }

  return ok(await enrichRecoveryCalls(admin, data ?? []));
}
