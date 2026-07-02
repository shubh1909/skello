"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { logSkeloError } from "@/lib/errors";
import {
  ShopifyApiError,
  getDiscountCodeForRule,
  listDiscountOffers,
} from "@/lib/shopify/client";
import { getShopifyIntegration } from "@/lib/shopify/integration";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionResult, fail, ok } from "@/types/action";
import type {
  RecoveryAttemptRow,
  RecoveryCallRow,
  RecoveryCartItem,
  RecoveryMetrics,
  RecoveryPage,
  ShopifyOfferOption,
  ShopifyRecoverySettings,
} from "@/types/shopify";

export interface RecoveryOverview {
  connected: boolean;
  settings: ShopifyRecoverySettings | null;
  metrics: RecoveryMetrics;
}

const SETTINGS_COLUMNS =
  "organisation_id, enabled, wait_minutes, max_attempts, retry_interval_seconds, agent_id, offer_type, offer_code, offer_label, offer_discount_value, offer_discount_kind, created_at, updated_at";

const ATTEMPT_COLUMNS =
  "id, status, skip_reason, customer_name, email, phone, marketing_consent, cart_total, currency, cart_items, offer_label, offer_code, attempt, max_attempts, last_status, created_at, abandoned_at, scheduled_at, next_attempt_at, canceled_at, converted_at";

const CALL_COLUMNS =
  "id, status, direction, to_phone, from_phone, created_at, started_at, answered_at, ended_at, duration_seconds, recording_url, transcript, summary, name_extracted, interest, lead_intent_extracted, customer_status, call_outcome, requested_callback_at, connect_on_whatsapp, visit_scheduled_at, lead_data, custom_data, shopify_recovery_attempt_id, lead_id";

const PAGE_SIZE = 20;

// Strict ROI attribution: a conversion counts only when a recovery call actually
// completed (we reached the shopper) AND that call ended before the order was
// placed. Returns the subset of the given converted attempts that qualify.
async function attributedAttemptIds(
  admin: ReturnType<typeof createAdminClient>,
  converted: Array<{ id: string; converted_at: string | null }>,
): Promise<Set<string>> {
  const attributed = new Set<string>();
  const ids = converted.map((a) => a.id);
  if (ids.length === 0) return attributed;

  const { data: calls } = await admin
    .from("calls")
    .select("shopify_recovery_attempt_id, ended_at")
    .in("shopify_recovery_attempt_id", ids)
    .eq("status", "completed")
    .not("ended_at", "is", null)
    .returns<
      Array<{ shopify_recovery_attempt_id: string; ended_at: string }>
    >();

  // Earliest completed-call end per attempt.
  const firstEnd = new Map<string, number>();
  for (const c of calls ?? []) {
    const t = new Date(c.ended_at).getTime();
    const prev = firstEnd.get(c.shopify_recovery_attempt_id);
    if (prev === undefined || t < prev) {
      firstEnd.set(c.shopify_recovery_attempt_id, t);
    }
  }
  for (const a of converted) {
    const end = firstEnd.get(a.id);
    if (a.converted_at && end !== undefined && end <= new Date(a.converted_at).getTime()) {
      attributed.add(a.id);
    }
  }
  return attributed;
}

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
    abandonedRes,
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
    // Actioned carts (excludes skipped) — closer to Shopify's "abandoned".
    admin
      .from("shopify_recovery_attempts")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", orgId)
      .neq("status", "skipped"),
    admin
      .from("shopify_recovery_attempts")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", orgId)
      .gt("attempt", 0),
    // Every conversion (attributed + organic) — attribution computed below.
    admin
      .from("shopify_recovery_attempts")
      .select("id, cart_total, currency, converted_at")
      .eq("organisation_id", orgId)
      .not("converted_at", "is", null)
      .limit(5000)
      .returns<
        Array<{
          id: string;
          cart_total: number | null;
          currency: string | null;
          converted_at: string | null;
        }>
      >(),
  ]);

  const converted = convertedRes.data ?? [];
  const attributed = await attributedAttemptIds(admin, converted);
  const attributedRows = converted.filter((r) => attributed.has(r.id));
  const revenue = attributedRows.reduce((sum, r) => sum + (r.cart_total ?? 0), 0);

  const metrics: RecoveryMetrics = {
    abandoned: abandonedRes.count ?? 0,
    calls_made: callsMadeRes.count ?? 0,
    recovered: attributedRows.length,
    conversions_total: converted.length,
    revenue_recovered: revenue,
    currency:
      attributedRows.find((r) => r.currency)?.currency ??
      converted.find((r) => r.currency)?.currency ??
      null,
  };

  return ok({
    connected: Boolean(
      integrationRes.data?.access_token && integrationRes.data?.enabled,
    ),
    settings: settingsRes.data ?? null,
    metrics,
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
  offer_label: z.string().trim().max(200).nullable().optional(),
  // Numeric discount captured from the chosen Shopify price rule. Optional —
  // a manually-typed offer label has no matching rule, so the agent just
  // quotes the cart total without a discounted figure.
  offer_discount_value: z.number().min(0).nullable().optional(),
  offer_discount_kind: z.enum(["percentage", "fixed_amount"]).nullable().optional(),
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

// Resolve the redeemable discount code for a chosen price rule, so the form can
// auto-fill it (rather than the operator hand-typing it). Org-scoped; the rule
// id is validated as a bare Shopify numeric id.
export async function getShopifyOfferCode(
  priceRuleId: unknown,
): Promise<ActionResult<{ code: string | null }>> {
  const session = await requireSession();
  const parsed = z.string().regex(/^\d+$/, "Invalid offer id").safeParse(priceRuleId);
  if (!parsed.success) return fail("Invalid offer id");

  const integration = await getShopifyIntegration(session.organisation.id);
  if (!integration || !integration.access_token) {
    return fail("Shopify isn't connected for this workspace yet.");
  }

  try {
    const code = await getDiscountCodeForRule(
      {
        shopDomain: integration.shop_domain,
        accessToken: integration.access_token,
        apiVersion: integration.api_version,
      },
      parsed.data,
    );
    return ok({ code });
  } catch (err) {
    if (err instanceof ShopifyApiError) {
      return fail(`Couldn't load the discount code from Shopify: ${err.message}`);
    }
    return fail(
      logSkeloError("SHOPIFY", "Failed to fetch Shopify offer code", {
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
  }

  revalidatePath("/campaigns/templates/cart-recovery");
  return ok({ running: parsed.data });
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

  const { data, error } = await admin
    .from("shopify_recovery_attempts")
    .select(
      "created_at, customer_name, email, phone, status, skip_reason, cart_total, currency, offer_label, offer_code, attempt, converted_at",
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

  const header = [
    "Created",
    "Shopper",
    "Email",
    "Phone",
    "Status",
    "Skip reason",
    "Cart total",
    "Currency",
    "Offer",
    "Discount code",
    "Attempts",
    "Converted at",
  ];
  const rows = (data ?? []).map((r) =>
    [
      r.created_at,
      r.customer_name,
      r.email,
      r.phone,
      r.status,
      r.skip_reason,
      r.cart_total,
      r.currency,
      r.offer_label,
      r.offer_code,
      r.attempt,
      r.converted_at,
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
  callableOnly: z.boolean().optional(),
});

function pageRange(page: number): [number, number] {
  const from = page * PAGE_SIZE;
  return [from, from + PAGE_SIZE - 1];
}

// Abandoned = not yet converted (any status). `callableOnly` hides carts we
// can't dial (skipped / no phone).
export async function getAbandonedCarts(
  input: unknown,
): Promise<ActionResult<RecoveryPage<RecoveryAttemptRow>>> {
  const session = await requireSession();
  const parsed = pageInput.safeParse(input ?? {});
  if (!parsed.success) return fail("Invalid request");
  const page = parsed.data.page ?? 0;
  const admin = createAdminClient();

  let query = admin
    .from("shopify_recovery_attempts")
    .select(ATTEMPT_COLUMNS, { count: "exact" })
    .eq("organisation_id", session.organisation.id)
    .is("converted_at", null);
  if (parsed.data.callableOnly) {
    query = query.neq("status", "skipped").not("phone", "is", null);
  }

  const [from, to] = pageRange(page);
  const { data, count, error } = await query
    .order("created_at", { ascending: false })
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
  return ok({ rows: data ?? [], total: count ?? 0 });
}

// Converted = order placed against the checkout. Each row is flagged as
// call-attributed (strict) or organic.
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
    .not("converted_at", "is", null)
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

  const rows = data ?? [];
  const attributed = await attributedAttemptIds(
    admin,
    rows.map((r) => ({ id: r.id, converted_at: r.converted_at })),
  );
  return ok({
    rows: rows.map((r) => ({ ...r, attributed: attributed.has(r.id) })),
    total: count ?? 0,
  });
}

interface RawCallRow {
  id: string;
  status: string;
  direction: string;
  to_phone: string | null;
  from_phone: string | null;
  created_at: string;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  transcript: string | null;
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

  const calls = data ?? [];
  // Enrich each call with its cart snapshot + the lead's current view. Neither
  // relationship is embedded (calls.shopify_recovery_attempt_id has no FK, and
  // embedding leads proved brittle across schema caches), so we fetch both by id.
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

  const rows: RecoveryCallRow[] = calls.map((c) => {
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
      created_at: c.created_at,
      started_at: c.started_at,
      answered_at: c.answered_at,
      ended_at: c.ended_at,
      duration_seconds: c.duration_seconds,
      recording_url: c.recording_url,
      transcript: c.transcript,
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

  return ok({ rows, total: count ?? 0 });
}
