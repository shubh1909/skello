export type LeadFieldOverrideAction = "set" | "unlock";

export interface LeadFieldOverride {
  id: string;
  lead_id: string;
  organisation_id: string;
  field_path: string;
  action: LeadFieldOverrideAction;
  value: unknown;
  previous_value: unknown;
  reason: string | null;
  edited_by: string | null;
  edited_at: string;
}
