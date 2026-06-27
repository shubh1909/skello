import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

// Persist (or refresh) the org's Shopify connection. The access token is
// secret, so this writes via the service-role client — `shopify_integrations`
// has RLS on with no authenticated policies, mirroring `bolna_integrations`.
export async function saveShopifyIntegration(input: {
  organisationId: string;
  shopDomain: string;
  accessToken: string;
  scope: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("shopify_integrations").upsert(
    {
      organisation_id: input.organisationId,
      shop_domain: input.shopDomain,
      access_token: input.accessToken,
      scope: input.scope,
      enabled: true,
    },
    { onConflict: "organisation_id" },
  );
  if (error) throw new Error(error.message);
}

// Map a myshopify domain → organisation_id. The webhook handler will use this
// to resolve tenancy server-side (never trusting the payload).
export async function resolveOrgByShopDomain(
  shop: string,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("shopify_integrations")
    .select("organisation_id")
    .eq("shop_domain", shop)
    .maybeSingle<{ organisation_id: string }>();
  return data?.organisation_id ?? null;
}
