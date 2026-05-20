// "column" — first-class table column (e.g. `inbound_calls`, `current_intent`)
//            whose visibility / filterability / sortability is also admin-
//            toggleable. Seeded per-org via the trigger in migration
//            20260520000001; the value lives in the lead row or the
//            call-aggregate CTE rather than a JSONB blob.
export type LeadFieldSource = "lead_data" | "custom_data" | "column";

export type LeadFieldDataType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "enum"
  | "unknown";

export interface LeadFieldDefinition {
  id: string;
  organisation_id: string;
  source_column: LeadFieldSource;
  category: string;
  key_path: string;
  label: string | null;
  data_type: LeadFieldDataType;
  visible_in_table: boolean;
  filterable: boolean;
  sortable: boolean;
  searchable: boolean;
  display_order: number;
  sample_value: unknown;
  enum_options: string[] | null;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}
