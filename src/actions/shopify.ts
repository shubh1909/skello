"use server";

import { requireSession } from "@/lib/auth/session";
import { getShopifyIntegration } from "@/lib/shopify/integration";
import { type ActionResult, ok } from "@/types/action";
import type { ShopifyIntegrationStatus } from "@/types/shopify";

// Org-facing, read-only view of the store connection for the settings page.
// Connecting/authorizing a store is admin-only; owners just see the state.
// Redacts secrets (api_secret, access_token) — mirrors the admin `toStatus`.
export async function getShopifyStatus(): Promise<
  ActionResult<ShopifyIntegrationStatus | null>
> {
  const session = await requireSession();
  const row = await getShopifyIntegration(session.organisation.id);
  if (!row) return ok(null);
  return ok({
    shop_domain: row.shop_domain,
    api_version: row.api_version,
    scope: row.scope,
    enabled: row.enabled,
    connected: true,
    authorized: Boolean(row.access_token),
    updated_at: row.updated_at,
  });
}
