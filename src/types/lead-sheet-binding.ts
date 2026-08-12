import type { LeadFieldSource } from "./lead-field-definition";

/**
 * Where on the lead detail sheet a binding renders.
 *
 * - `stat_card`   the three cards under the tab bar (0-2, capped in the DB)
 * - `wants`       the "what they want" definition list
 * - `header_meta` the muted line under the lead's name
 */
export type LeadSheetSlot = "stat_card" | "wants" | "header_meta";

/** How the resolved value is rendered. Mirrors the DB's format CHECK. */
export type LeadSheetFormat =
  | "text"
  | "number"
  | "currency_inr"
  | "date"
  | "datetime"
  | "boolean"
  | "enum_badge";

/**
 * One admin-configured field on the lead sheet.
 *
 * `(source_column, category, key_path)` is the same address a
 * `LeadFieldDefinition` uses, so the admin picker can offer the catalog
 * directly. The caption triple addresses a second field for the small muted
 * line under a stat card's value; `caption_static` is the fixed-string
 * alternative. The DB rejects setting both.
 */
export interface LeadSheetBinding {
  id: string;
  organisation_id: string;
  slot: LeadSheetSlot;
  slot_position: number;
  label: string;
  source_column: LeadFieldSource;
  category: string;
  key_path: string;
  caption_source_column: LeadFieldSource | null;
  caption_category: string;
  caption_key_path: string | null;
  caption_static: string | null;
  format: LeadSheetFormat;
  created_at: string;
  updated_at: string;
}
