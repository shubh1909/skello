// A per-org Shopify connection row (mirrors public.shopify_integrations).
// Holds secrets (api_secret, access_token) — NEVER send this to the client.
// access_token is null until the store is authorized via OAuth.
export interface ShopifyIntegration {
  organisation_id: string;
  shop_domain: string;
  client_id: string;
  api_secret: string;
  access_token: string | null;
  api_version: string;
  scope: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

// Client-safe view of the connection — the redacted shape the admin UI sees.
// Deliberately omits api_secret and access_token.
//   connected  = credentials saved
//   authorized = OAuth completed (we hold an access token)
export interface ShopifyIntegrationStatus {
  shop_domain: string;
  api_version: string;
  scope: string;
  enabled: boolean;
  connected: boolean;
  authorized: boolean;
  updated_at: string;
}

export type ShopifyOfferType = "none" | "discount_code" | "free_product";

// The org-tunable cart-recovery levers (offer + timing).
export interface ShopifyRecoverySettings {
  organisation_id: string;
  enabled: boolean;
  wait_minutes: number;
  max_attempts: number;
  retry_interval_seconds: number;
  agent_id: string | null;
  offer_type: ShopifyOfferType;
  offer_code: string | null;
  offer_label: string | null;
  created_at: string;
  updated_at: string;
}

export type RecoveryAttemptStatus =
  | "pending"
  | "in_flight"
  | "succeeded"
  | "failed"
  | "canceled"
  | "skipped";

export interface RecoveryCartItem {
  title: string;
  quantity: number;
}

// A row in the cart-recovery activity feed (dashboard-facing subset).
export interface RecoveryAttemptRow {
  id: string;
  status: RecoveryAttemptStatus;
  skip_reason: string | null;
  customer_name: string | null;
  phone: string | null;
  cart_total: number | null;
  currency: string | null;
  cart_items: RecoveryCartItem[];
  offer_label: string | null;
  attempt: number;
  converted_at: string | null;
  created_at: string;
}

// Headline metrics for the cart-recovery dashboard.
export interface RecoveryMetrics {
  abandoned: number; // attempts created (excludes skipped)
  calls_made: number; // attempts that reached at least one dial
  recovered: number; // converted_at set
  revenue_recovered: number; // sum of cart_total for recovered
  currency: string | null;
}

// What an org picks from when configuring the offer (fetched from Shopify).
export interface ShopifyOfferOption {
  id: string;
  title: string;
}
