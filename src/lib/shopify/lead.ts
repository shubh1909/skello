import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { RecoveryCartItem } from "@/types/shopify";

// Mirror leads.phone_normalized so the dedup lookup matches the generated column.
function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  return digits.length === 0 ? null : digits;
}

interface FindOrCreateShopifyLeadInput {
  organisationId: string;
  phone: string | null;
  name: string | null;
  cart: {
    checkoutToken: string;
    cartTotal: number | null;
    currency: string | null;
    recoveryUrl: string | null;
    lineItems: RecoveryCartItem[];
  };
}

/**
 * Find-or-create the lead for (org, phone) from an abandoned checkout, attaching
 * the cart snapshot under custom_data.shopify. Reuses the same dedup discipline
 * as the Bolna lead-merge path: lookup by (organisation_id, phone_normalized)
 * filtered on deleted_at IS NULL, with the unique-index race handled on insert.
 */
export async function findOrCreateShopifyLead(
  input: FindOrCreateShopifyLeadInput,
): Promise<string | null> {
  const admin = createAdminClient();
  const phoneNorm = normalizePhone(input.phone);
  if (!phoneNorm) return null; // recovery only acts on contactable carts

  const shopifyContext = {
    checkout_token: input.cart.checkoutToken,
    cart_total: input.cart.cartTotal,
    currency: input.cart.currency,
    recovery_url: input.cart.recoveryUrl,
    items: input.cart.lineItems,
  };

  const { data: existing } = await admin
    .from("leads")
    .select("id")
    .eq("organisation_id", input.organisationId)
    .eq("phone_normalized", phoneNorm)
    .is("deleted_at", null)
    .maybeSingle<{ id: string }>();

  if (existing) {
    // Refresh the cart context on the existing lead (override-free — this is
    // operational context, not an extracted field).
    await admin
      .from("leads")
      .update({
        custom_data: { shopify: shopifyContext },
        last_contact_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    return existing.id;
  }

  const { data: org } = await admin
    .from("organisations")
    .select("slug")
    .eq("id", input.organisationId)
    .maybeSingle<{ slug: string }>();

  const now = new Date().toISOString();
  const { data: created, error } = await admin
    .from("leads")
    .insert({
      organisation_id: input.organisationId,
      org_slug: org?.slug ?? null,
      phone: input.phone,
      name: input.name,
      source: "shopify",
      status: "new",
      first_seen_at: now,
      last_contact_at: now,
      custom_data: { shopify: shopifyContext },
    })
    .select("id")
    .single<{ id: string }>();

  if (!error && created) return created.id;

  // Lost the insert race — refetch the live row by the unique key.
  if (error?.code === "23505") {
    const { data: raced } = await admin
      .from("leads")
      .select("id")
      .eq("organisation_id", input.organisationId)
      .eq("phone_normalized", phoneNorm)
      .is("deleted_at", null)
      .maybeSingle<{ id: string }>();
    if (raced) return raced.id;
  }

  return null;
}
