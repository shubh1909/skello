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

export interface Lead {
  id: string;
  created_at: string;
  updated_at: string;
  org_slug: string | null;
  external_id: string | null;
  name: string | null;
  product: string | null;
  lead_intent: LeadIntent | null;
  visit_date_time: string | null;
  customer_status: string | null;
  phone: string | null;
  wants_to_connect_on_watsapp: boolean | null;
  contacted_on_watsapp: boolean | null;
  source: LeadSource | null;
  status: LeadStatus;
  notes: string | null;
  city: string | null;
  pincode: string | null;
}
