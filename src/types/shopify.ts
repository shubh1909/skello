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

// How a discount's numeric value is interpreted. Mirrors Shopify price-rule
// `value_type`: a percentage off, or a fixed currency amount off.
export type ShopifyDiscountKind = "percentage" | "fixed_amount";

// The org-tunable cart-recovery levers (offer + timing).
// Which WhatsApp recovery template body an org sends. See
// lib/shopify/recovery-templates.ts for the variable layout each one maps to.
export type RecoveryTemplateLayout = "classic" | "coupon_link";

export interface ShopifyRecoverySettings {
  organisation_id: string;
  enabled: boolean;
  wait_minutes: number;
  max_attempts: number;
  retry_interval_seconds: number;
  agent_id: string | null;
  offer_type: ShopifyOfferType;
  // The EXACT redeemable code (e.g. GRAB20). Read by the WhatsApp template and
  // the /discount/<code> checkout link — both need it verbatim.
  offer_code: string | null;
  // How the agent should SAY that code (e.g. "grab twenty"). The agent can't
  // reliably read alphanumerics aloud. Blank → falls back to offer_code. Never
  // reaches WhatsApp or the checkout link.
  offer_code_spoken: string | null;
  offer_label: string | null;
  // Numeric discount, auto-captured from the chosen Shopify price rule. Drives
  // the discounted-cart-value math the agent quotes on the call. Null when the
  // offer isn't a recognised price rule (manual label) or there's no offer.
  offer_discount_value: number | null;
  offer_discount_kind: ShopifyDiscountKind | null;
  // Daily calling window (tz-naive wall clock, evaluated in APP_TIMEZONE / IST).
  // Both null → dial around the clock. Stored as "HH:MM:SS".
  call_window_start: string | null;
  call_window_end: string | null;
  // Channels. Defaults reproduce voice-only behaviour (voice on, WhatsApp off).
  // Voice always dials first; when WhatsApp is enabled it is sent once the
  // connected call ends (or as a fallback if voice never connects).
  voice_enabled: boolean;
  whatsapp_enabled: boolean;
  // Optional per-org template override; null → the integration's default.
  whatsapp_template_name: string | null;
  // Which template body the org uses; drives positional variable mapping.
  whatsapp_template_layout: RecoveryTemplateLayout;
  created_at: string;
  updated_at: string;
}

// Read-only view of the WhatsApp channel for the dashboard card. Never names the
// underlying provider — product copy says "WhatsApp".
export interface RecoveryWhatsAppStatus {
  configured: boolean; // integration present, enabled, and a template is set
  enabled: boolean; // whatsapp_enabled in recovery settings
  sender: string | null;
  templateName: string | null;
}

export type RecoveryMessageStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

// One WhatsApp send for a cart (the whatsapp equivalent of a RecoveryCallRow),
// shown in the cart detail drawer timeline.
export interface RecoveryMessageRow {
  id: string;
  to_phone: string | null;
  template_name: string | null;
  provider: string;
  provider_message_id: string | null;
  status: RecoveryMessageStatus;
  error_message: string | null;
  // Meta's numeric code for a rejection (131049 = per-user marketing cap,
  // 132001 = template not found, …). The stable half of the failure — the text
  // beside it is the provider's and changes wording without notice.
  error_code: number | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
}

// Read-only view of the voice agent wired to recovery, for the dashboard. Never
// names the underlying provider — product copy says "voice agent".
export interface RecoveryVoiceAgent {
  name: string | null; // friendly agent label
  callerNumber: string | null; // the number calls are placed from
  configured: boolean; // an agent is set and enabled
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
  // Line order value (unit price × quantity), pre-offer. Used to rank items so
  // the agent leads with the highest-value product. Not sent to the agent as a
  // per-item figure — only the cart-level totals are quoted.
  lineValue: number;
}

// A row in the cart-recovery tables (abandoned + converted tabs).
export interface RecoveryAttemptRow {
  id: string;
  status: RecoveryAttemptStatus;
  skip_reason: string | null;
  customer_name: string | null;
  email: string | null;
  phone: string | null;
  marketing_consent: boolean | null;
  cart_total: number | null;
  currency: string | null;
  cart_items: RecoveryCartItem[];
  offer_label: string | null;
  offer_code: string | null;
  offer_code_spoken: string | null;
  attempt: number;
  max_attempts: number;
  last_status: string | null;
  created_at: string; // when we recorded the cart (webhook receipt)
  abandoned_at: string | null; // Shopify's checkout-created time (true abandonment)
  scheduled_at: string | null;
  next_attempt_at: string | null;
  canceled_at: string | null;
  converted_at: string | null;
  // WhatsApp channel track (parallel to the voice status/attempt fields above).
  whatsapp_status: RecoveryWhatsAppTrackStatus;
  whatsapp_sent_at: string | null;
  // When the WhatsApp track is next due to send (its own schedule, distinct from
  // voice's next_attempt_at). Surfaced as the "next" time on a queued WA chip.
  whatsapp_next_at: string | null;
  // Why the WhatsApp track was skipped (e.g. marketing_cap, opted_out,
  // undeliverable, no_template) — set for whatsapp_status = 'skipped'.
  whatsapp_skip_reason: string | null;
  // The last WhatsApp error text (send-time or Meta delivery). Set for
  // whatsapp_status = 'failed'; classified for the compact reason on the chip.
  whatsapp_error: string | null;
  // When the shopper FIRST opened the short recovery link. Cart-level, not
  // per-message: the token belongs to the attempt, so a click can't be pinned
  // to one message when retries sent several. Proves our message drove the
  // visit — independent of any checkout/cart token join.
  clicked_at: string | null;
  // How the conversion matched its order: 'token' (Shopify attributes the same
  // way) or 'phone' (tokenless GoKwik order — Shopify can't see it as recovered).
  // Null until converted. Explains our-vs-Shopify discrepancies.
  conversion_match: "token" | "phone" | null;
  // Converted tab only: was the conversion attributable to a completed call
  // that ended before the order (strict ROI attribution)?
  attributed?: boolean;
  // Furthest state META reported across this cart's messages — derived from
  // shopify_recovery_messages, not stored on the attempt (whatsapp_status above
  // is only OUR send track and can't tell you whether it landed). Batch-loaded
  // for the listed page; absent on rows fetched outside the table queries.
  whatsapp_delivery?: RecoveryMessageStatus | null;
}

export type RecoveryWhatsAppTrackStatus =
  | "none"
  | "pending"
  | "in_flight"
  | "sent"
  | "failed"
  | "skipped"
  | "canceled";

// One recovery call, enriched with its cart + lead context for the call-history
// tab. Extracted fields are null until the post-call webhook fills them.
export interface RecoveryCallRow {
  id: string;
  status: string;
  direction: string;
  to_phone: string | null;
  from_phone: string | null;
  // Failure diagnostics. error_message is set when initiation fails (call never
  // placed); bolna_call_id present means the provider accepted the dial.
  error_message: string | null;
  bolna_call_id: string | null;
  created_at: string;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  transcript: string | null;
  transcript_url: string | null;
  summary: string | null;
  // Extracted / dynamic call data.
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
  // Cart being recovered (from the attempt snapshot).
  cart_total: number | null;
  currency: string | null;
  cart_items: RecoveryCartItem[];
  customer_name: string | null;
  // Persistent lead view, if linked.
  lead_name: string | null;
  lead_status: string | null;
  lead_intent: string | null;
}

// One page of rows plus the total count for pagination.
export interface RecoveryPage<T> {
  rows: T[];
  total: number;
}

// Headline metrics for the cart-recovery dashboard.
export interface RecoveryMetrics {
  abandoned: number; // actioned carts (excludes skipped)
  calls_made: number; // attempts that reached at least one dial
  recovered: number; // call-attributed recoveries (reached + converted after)
  conversions_total: number; // all conversions (incl. organic)
  revenue_recovered: number; // sum of cart_total for attributed recoveries
  currency: string | null;
}

// What an org picks from when configuring the offer (fetched from Shopify via
// the GraphQL Admin API — all active code discounts, legacy + new-engine).
// value/valueType let us compute the discounted cart value the agent quotes;
// null when the discount has no usable numeric value (e.g. BXGY / free shipping).
export interface ShopifyOfferOption {
  id: string; // discount node GID, e.g. gid://shopify/DiscountCodeNode/123
  title: string;
  // The redeemable code, resolved inline from the discount (no second call).
  code: string | null;
  value: number | null;
  valueType: ShopifyDiscountKind | null;
}
