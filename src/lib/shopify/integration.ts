import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { ShopifyIntegration } from "@/types/shopify";

// Secrets live here, so every read/write goes through the service-role client —
// shopify_integrations has RLS on with no authenticated policies (same posture
// as bolna_integrations).
const COLUMNS =
  "organisation_id, shop_domain, client_id, api_secret, access_token, api_version, scope, enabled, created_at, updated_at";

// Save (or update) a store's APP credentials. Does NOT touch access_token —
// that's minted later by the OAuth callback — so re-saving credentials keeps an
// existing authorization intact.
export async function upsertShopifyCredentials(input: {
  organisationId: string;
  shopDomain: string;
  clientId: string;
  apiSecret: string;
  apiVersion: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("shopify_integrations").upsert(
    {
      organisation_id: input.organisationId,
      shop_domain: input.shopDomain,
      client_id: input.clientId,
      api_secret: input.apiSecret,
      api_version: input.apiVersion,
      enabled: true,
    },
    { onConflict: "organisation_id" },
  );
  if (error) throw new Error(error.message);
}

// Store the access token + granted scopes returned by the OAuth callback.
export async function setShopifyAccessToken(input: {
  organisationId: string;
  accessToken: string;
  scope: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("shopify_integrations")
    .update({ access_token: input.accessToken, scope: input.scope })
    .eq("organisation_id", input.organisationId);
  if (error) throw new Error(error.message);
}

export async function getShopifyIntegration(
  organisationId: string,
): Promise<ShopifyIntegration | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("shopify_integrations")
    .select(COLUMNS)
    .eq("organisation_id", organisationId)
    .maybeSingle<ShopifyIntegration>();
  return data ?? null;
}

// Resolve a store's connection by its myshopify domain. The webhook + OAuth
// callback use this to find the tenant (and that tenant's api_secret) entirely
// server-side, never trusting the payload.
export async function resolveShopifyIntegrationByShop(
  shopDomain: string,
): Promise<ShopifyIntegration | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("shopify_integrations")
    .select(COLUMNS)
    .eq("shop_domain", shopDomain)
    .maybeSingle<ShopifyIntegration>();
  return data ?? null;
}

export async function deleteShopifyIntegration(
  organisationId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("shopify_integrations")
    .delete()
    .eq("organisation_id", organisationId);
  if (error) throw new Error(error.message);
}
