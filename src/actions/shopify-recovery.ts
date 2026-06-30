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
  RecoveryMetrics,
  ShopifyOfferOption,
  ShopifyRecoverySettings,
} from "@/types/shopify";

export interface RecoveryOverview {
  connected: boolean;
  settings: ShopifyRecoverySettings | null;
  metrics: RecoveryMetrics;
  attempts: RecoveryAttemptRow[];
}

const SETTINGS_COLUMNS =
  "organisation_id, enabled, wait_minutes, max_attempts, retry_interval_seconds, agent_id, offer_type, offer_code, offer_label, offer_discount_value, offer_discount_kind, created_at, updated_at";

const ATTEMPT_COLUMNS =
  "id, status, skip_reason, customer_name, email, phone, cart_total, currency, cart_items, offer_label, attempt, converted_at, created_at";

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
    attemptsRes,
    totalRes,
    callsRes,
    recoveredRes,
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
      admin
        .from("shopify_recovery_attempts")
        .select(ATTEMPT_COLUMNS)
        .eq("organisation_id", orgId)
        .order("created_at", { ascending: false })
        .limit(50)
        .returns<RecoveryAttemptRow[]>(),
      admin
        .from("shopify_recovery_attempts")
        .select("id", { count: "exact", head: true })
        .eq("organisation_id", orgId),
      admin
        .from("shopify_recovery_attempts")
        .select("id", { count: "exact", head: true })
        .eq("organisation_id", orgId)
        .gt("attempt", 0),
      admin
        .from("shopify_recovery_attempts")
        .select("id", { count: "exact", head: true })
        .eq("organisation_id", orgId)
        .not("converted_at", "is", null),
      admin
        .from("shopify_recovery_attempts")
        .select("cart_total, currency")
        .eq("organisation_id", orgId)
        .not("converted_at", "is", null)
        .returns<{ cart_total: number | null; currency: string | null }[]>(),
    ]);

  const converted = convertedRes.data ?? [];
  const revenue = converted.reduce((sum, r) => sum + (r.cart_total ?? 0), 0);

  const metrics: RecoveryMetrics = {
    abandoned: totalRes.count ?? 0,
    calls_made: callsRes.count ?? 0,
    recovered: recoveredRes.count ?? 0,
    revenue_recovered: revenue,
    currency: converted.find((r) => r.currency)?.currency ?? null,
  };

  return ok({
    connected: Boolean(
      integrationRes.data?.access_token && integrationRes.data?.enabled,
    ),
    settings: settingsRes.data ?? null,
    metrics,
    attempts: attemptsRes.data ?? [],
  });
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
