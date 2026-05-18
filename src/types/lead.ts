// Mirrors the Postgres enum `intent_type` (lowercase values).
export type LeadIntent = "hot" | "warm" | "cold";

// Mirrors the Postgres enum `lead_source`.
export type LeadSource =
  | "inbound_call"
  | "whatsapp"
  | "manual"
  | "import"
  | "web_form";

// Mirrors the Postgres enum `lead_status`.
export type LeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "negotiating"
  | "won"
  | "lost";

// Post-remodel shape. One row per (organisation_id, phone_normalized).
//
// Several legacy fields (interest, customer_status, wants_to_connect_on_watsapp,
// visit_date_time, lead_intent) are still exposed for UI back-compat, but
// they are now DERIVED — populated from lead_data jsonb on read by
// actions/leads.ts. The original columns no longer exist on the table.
//
// Per-call snapshots (summary, actionable, recording_url) live on the
// `calls` table now. We surface "latest call" versions here for at-a-glance
// display.
export interface Lead {
  id: string;
  created_at: string;
  updated_at: string;
  organisation_id: string;
  // Denormalized convenience; will be dropped in a future cleanup.
  org_slug: string | null;

  // Identity (immutable on the lead row).
  phone: string | null;
  phone_normalized: string | null;
  first_seen_at: string | null;
  last_contact_at: string | null;

  // Current view (admin-editable, also auto-filled by webhook).
  name: string | null;
  current_intent: LeadIntent | null;
  city: string | null;
  pincode: string | null;

  // Admin-owned (webhook never writes).
  notes: string | null;
  status: LeadStatus;
  pending_action: boolean;
  source: LeadSource | null;

  // Dynamic fields — full provider extraction + free-form catch-all.
  lead_data: Record<string, unknown>;
  custom_data: Record<string, Record<string, unknown>>;

  // ---- Back-compat derived fields (populated by actions/leads.ts) ----
  // These are NOT actual columns — they're computed on read so existing UI
  // keeps working. Writes go through the appropriate dynamic-field path.
  lead_intent: LeadIntent | null;          // alias for current_intent
  interest: string | null;                  // from lead_data.interest
  customer_status: string | null;           // from lead_data.customer_status
  wants_to_connect_on_watsapp: boolean | null; // from lead_data.connect_on_whatsapp
  visit_date_time: string | null;           // from lead_data.date_and_time_of_visit
  // Latest call snapshot (best-effort; null if no calls yet).
  summary: string | null;
  actionable: string | null;
  recording_url: string | null;
  // Removed at the column level; surface as null for any consumer that
  // still references it.
  external_id: null;
}
