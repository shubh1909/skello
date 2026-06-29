"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth/admin";
import { logSkeloError } from "@/lib/errors";
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
