"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth/admin";
import { logSkeloError } from "@/lib/errors";
import {
  APP_PROXY_PREFIX,
  PROXY_PROBE_BAD_SIGNATURE,
  PROXY_PROBE_OK,
  PROXY_PROBE_TOKEN,
  PROXY_PROBE_UNKNOWN_SHOP,
} from "@/lib/shopify/app-proxy";
import {
  ShopifyApiError,
  ensureWebhooks,
  listShopifyWebhooks,
} from "@/lib/shopify/client";
import {
  deleteShopifyIntegration,
  getShopifyIntegration,
  upsertShopifyCredentials,
} from "@/lib/shopify/integration";
import { SHOPIFY_WEBHOOK_TOPICS } from "@/lib/shopify/webhooks";
import { type ActionResult, fail, ok } from "@/types/action";
import type {
  ShopifyIntegration,
  ShopifyIntegrationStatus,
} from "@/types/shopify";

// Mirrors the DB check — the canonical myshopify host only.
const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

const connectSchema = z.object({
  organisation_id: z.string().uuid(),
  shop_domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SHOP_DOMAIN_RE, "Enter the store's <name>.myshopify.com domain"),
  // The app's API key (client_id) and API secret key (shpss_…). The access
  // token is NOT entered here — it's minted by the OAuth "Authorize" step.
  client_id: z.string().trim().min(1, "API key is required").max(200),
  api_secret: z.string().trim().min(1, "API secret key is required").max(500),
  api_version: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}$/, "Use the YYYY-MM format, e.g. 2025-04"),
});

const orgIdSchema = z.object({ organisation_id: z.string().uuid() });

// Strip secrets — only the redacted status ever crosses back to the client.
function toStatus(row: ShopifyIntegration | null): ShopifyIntegrationStatus | null {
  if (!row) return null;
  return {
    shop_domain: row.shop_domain,
    api_version: row.api_version,
    scope: row.scope,
    enabled: row.enabled,
    connected: true,
    authorized: Boolean(row.access_token),
    updated_at: row.updated_at,
  };
}

// Save (or update) a store's app credentials. The token is minted separately by
// the OAuth flow — re-saving credentials keeps any existing authorization. The
// secret is write-only from the UI's perspective (stored, never read back).
export async function saveShopifyIntegration(
  input: unknown,
): Promise<ActionResult<ShopifyIntegrationStatus>> {
  await requireAdmin();
  const parsed = connectSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  try {
    await upsertShopifyCredentials({
      organisationId: parsed.data.organisation_id,
      shopDomain: parsed.data.shop_domain,
      clientId: parsed.data.client_id,
      apiSecret: parsed.data.api_secret,
      apiVersion: parsed.data.api_version,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Always log the raw cause server-side for debugging.
    logSkeloError("SHOPIFY", "Failed to save Shopify connection", {
      organisationId: parsed.data.organisation_id,
      cause: err,
    });
    // shop_domain is globally unique — a friendly message when it's taken.
    if (/duplicate|unique|23505/i.test(message)) {
      return fail("That store is already connected to another workspace.");
    }
    // The table/columns don't exist yet — the migrations haven't been applied.
    if (/schema cache|could not find|does not exist|relation|column/i.test(message)) {
      return fail(
        "Shopify storage isn't ready in this database yet. Apply the latest migrations (npx supabase db push) and try again.",
      );
    }
    return fail("Couldn't save the Shopify connection. Please try again.");
  }

  revalidatePath(`/admin/organisations/${parsed.data.organisation_id}/shopify`);
  const row = await getShopifyIntegration(parsed.data.organisation_id);
  return ok(toStatus(row) as ShopifyIntegrationStatus);
}

export async function getShopifyIntegrationStatus(
  input: unknown,
): Promise<ActionResult<ShopifyIntegrationStatus | null>> {
  await requireAdmin();
  const parsed = orgIdSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid organisation id");

  const row = await getShopifyIntegration(parsed.data.organisation_id);
  return ok(toStatus(row));
}

// Subscribe the connected store to the cart-recovery webhook topics, pointing
// at our shared endpoint. Idempotent — skips topics already registered.
export async function registerShopifyWebhooks(
  input: unknown,
): Promise<ActionResult<{ registered: string[]; alreadyPresent: string[] }>> {
  await requireAdmin();
  const parsed = orgIdSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid organisation id");

  const address = process.env.SHOPIFY_WEBHOOK_ADDRESS?.trim();
  if (!address) {
    return fail(
      "SHOPIFY_WEBHOOK_ADDRESS is not set — point it at https://<app>/api/webhooks/shopify",
    );
  }

  const integration = await getShopifyIntegration(parsed.data.organisation_id);
  if (!integration) return fail("Connect the store first");
  if (!integration.access_token) {
    return fail("Authorize the store first (the Authorize with Shopify button).");
  }

  try {
    const result = await ensureWebhooks(
      {
        shopDomain: integration.shop_domain,
        accessToken: integration.access_token,
        apiVersion: integration.api_version,
      },
      SHOPIFY_WEBHOOK_TOPICS,
      address,
    );
    return ok(result);
  } catch (err) {
    if (err instanceof ShopifyApiError) {
      return fail(`Shopify rejected the webhook setup: ${err.message}`);
    }
    return fail(
      logSkeloError("SHOPIFY", "Webhook registration failed", {
        organisationId: parsed.data.organisation_id,
        cause: err,
      }),
    );
  }
}

// List the webhooks currently registered on the store, so the admin can confirm
// what's live. Read-only.
export async function getRegisteredWebhooks(
  input: unknown,
): Promise<ActionResult<{ topic: string; address: string }[]>> {
  await requireAdmin();
  const parsed = orgIdSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid organisation id");

  const integration = await getShopifyIntegration(parsed.data.organisation_id);
  if (!integration) return fail("Connect the store first");
  if (!integration.access_token) {
    return fail("Authorize the store first (the Authorize with Shopify button).");
  }

  try {
    const hooks = await listShopifyWebhooks({
      shopDomain: integration.shop_domain,
      accessToken: integration.access_token,
      apiVersion: integration.api_version,
    });
    return ok(hooks.map((h) => ({ topic: h.topic, address: h.address })));
  } catch (err) {
    if (err instanceof ShopifyApiError) {
      return fail(`Shopify rejected the request: ${err.message}`);
    }
    return fail(
      logSkeloError("SHOPIFY", "Failed to list webhooks", {
        organisationId: parsed.data.organisation_id,
        cause: err,
      }),
    );
  }
}

// --- App Proxy health ------------------------------------------------------

// How long to wait on the storefront before calling it unreachable. Generous:
// a cold storefront can be slow, and a false "not configured" is worse than a
// slow check.
const PROBE_TIMEOUT_MS = 10_000;

export type AppProxyProbeStatus =
  | "ok"
  | "not_configured"
  | "bad_signature"
  | "unknown_shop"
  | "unreachable";

export interface AppProxyProbeResult {
  status: AppProxyProbeStatus;
  // Operator-facing hint (HTTP status, error class). Never shown as the primary
  // message — the UI maps `status` to the human explanation.
  detail: string | null;
  probedUrl: string;
}

/**
 * Ask the STORE whether this client's App Proxy is wired to us.
 *
 * We request the reserved probe token through the storefront, so Shopify itself
 * signs and proxies the request exactly as it would a real recovery link. What
 * comes back tells us which link in the chain is broken:
 *
 *   our marker OK             → proxy wired, shop known, api_secret correct
 *   our marker BAD_SIGNATURE  → proxy wired, but the api_secret we hold is wrong
 *   our marker UNKNOWN_SHOP   → proxy wired, but the shop resolves to no org
 *   anything else (Shopify's   → proxy NOT configured on that client's app
 *     own themed 404, a
 *     password page, …)
 *
 * This exists because the failure is otherwise SILENT: the token still mints,
 * the WhatsApp message still sends, and only the shopper ever sees the 404.
 */
export async function checkShopifyAppProxy(
  input: unknown,
): Promise<ActionResult<AppProxyProbeResult>> {
  await requireAdmin();
  const parsed = orgIdSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid organisation id");

  const integration = await getShopifyIntegration(parsed.data.organisation_id);
  if (!integration) return fail("Connect the store first");

  // Probe the canonical myshopify host. Real links use the store's PRIMARY
  // domain (from the abandoned-checkout URL), but the proxy is a storefront
  // feature and answers on both; myshopify is the one we always know, and any
  // redirect to the primary domain is followed.
  const probedUrl = `https://${integration.shop_domain}${APP_PROXY_PREFIX}/r/${PROXY_PROBE_TOKEN}`;

  let response: Response;
  try {
    response = await fetch(probedUrl, {
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (err) {
    logSkeloError("SHOPIFY", "App proxy probe could not reach the store", {
      organisationId: parsed.data.organisation_id,
      cause: err,
    });
    return ok({
      status: "unreachable",
      detail: err instanceof Error ? err.name : "Network error",
      probedUrl,
    });
  }

  const body = await response.text().catch(() => "");
  const detail = `HTTP ${response.status}`;

  if (body.includes(PROXY_PROBE_OK)) {
    return ok({ status: "ok", detail: null, probedUrl });
  }
  if (body.includes(PROXY_PROBE_BAD_SIGNATURE)) {
    return ok({ status: "bad_signature", detail, probedUrl });
  }
  if (body.includes(PROXY_PROBE_UNKNOWN_SHOP)) {
    return ok({ status: "unknown_shop", detail, probedUrl });
  }
  // Nothing of ours came back, so the request never reached us.
  return ok({ status: "not_configured", detail, probedUrl });
}

export async function disconnectShopify(
  input: unknown,
): Promise<ActionResult<{ ok: true }>> {
  await requireAdmin();
  const parsed = orgIdSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid organisation id");

  try {
    await deleteShopifyIntegration(parsed.data.organisation_id);
  } catch (err) {
    return fail(
      logSkeloError("SHOPIFY", "Failed to disconnect Shopify", {
        organisationId: parsed.data.organisation_id,
        cause: err,
      }),
    );
  }

  revalidatePath(`/admin/organisations/${parsed.data.organisation_id}/shopify`);
  return ok({ ok: true });
}
