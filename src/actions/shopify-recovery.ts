"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { logSkeloError } from "@/lib/errors";
import { ShopifyApiError, listDiscountOffers } from "@/lib/shopify/client";
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
  "organisation_id, enabled, wait_minutes, max_attempts, retry_interval_seconds, agent_id, offer_type, offer_code, offer_label, created_at, updated_at";

const ATTEMPT_COLUMNS =
  "id, status, skip_reason, customer_name, phone, cart_total, currency, cart_items, offer_label, attempt, converted_at, created_at";

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
