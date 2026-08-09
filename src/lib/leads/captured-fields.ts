import { UNGROUPED_CATEGORIES } from "@/lib/csv-custom-fields";

/**
 * Which extracted keys a surface already shows as a first-class field, and how
 * the generic "everything else" grid is built from what's left.
 *
 * ## Why the dedupe sets exist at all
 *
 * One JSONB blob feeds two things: a curated list of named fields, and a
 * generic dump of whatever else the agent extracted. Without a skip-list the
 * same value renders twice on the same screen. That is true under any layout,
 * so these are not a symptom of the old flat design.
 *
 * ## Why there are three of them
 *
 * They differ, and each difference is real — but they were three hand-written
 * literals in three files, which is how they drift. One base, explicit deltas.
 */
const CALL_SURFACED_BASE = [
  "name",
  "interest",
  "lead_intent",
  "actionable",
  "customer_status",
  "connect_on_whatsapp",
  "date_and_time_of_visit",
  // Internal routing key from the extractor — never user-facing.
  "business_slug",
] as const;

/** A single call's detail pane. */
export const CALL_LEAD_DATA_SURFACED: ReadonlySet<string> = new Set(
  CALL_SURFACED_BASE,
);

/** The lead summary — its `<dl>` also has City and Pincode columns. */
export const LEAD_DATA_SURFACED: ReadonlySet<string> = new Set([
  ...CALL_SURFACED_BASE,
  "city",
  "pincode",
]);

/** The transcript dialog — it additionally promotes `product` to a field. */
export const TRANSCRIPT_SURFACED: ReadonlySet<string> = new Set([
  ...CALL_SURFACED_BASE,
  "product",
]);

/**
 * Everything in a `lead_data` blob that some other part of the screen isn't
 * already showing. Null, undefined and blank strings are dropped — an absent
 * key in an open-ended blob carries no meaning worth a row.
 */
export function pickLeadDataExtras(
  data: Record<string, unknown> | null | undefined,
  skip: ReadonlySet<string>,
): Record<string, unknown> | null {
  if (!data) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (skip.has(k)) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export interface CustomFieldsGroup {
  /** Empty string for the ungrouped bucket, which always sorts first. */
  category: string;
  entries: Array<[string, unknown]>;
}

/**
 * Fold `custom_data`'s categories and the leftover flat `lead_data` keys into
 * one ordered list of groups.
 *
 * Categories in `UNGROUPED_CATEGORIES` (shared with the CSV exports, so the two
 * can't disagree about what "ungrouped" means) are hoisted to the top level
 * rather than rendering an empty heading.
 */
export function buildCustomFieldGroups(
  customData: Record<string, unknown> | null | undefined,
  extraLeadData: Record<string, unknown> | null | undefined,
): CustomFieldsGroup[] {
  const groups: CustomFieldsGroup[] = [];
  const ungrouped: Array<[string, unknown]> = [];

  if (extraLeadData) {
    for (const [k, v] of Object.entries(extraLeadData)) {
      if (v === null || v === undefined) continue;
      ungrouped.push([k, v]);
    }
  }

  if (customData && typeof customData === "object") {
    for (const [cat, bag] of Object.entries(customData)) {
      if (!bag || typeof bag !== "object") continue;
      const entries = Object.entries(bag as Record<string, unknown>).filter(
        ([, v]) =>
          v !== null &&
          v !== undefined &&
          !(typeof v === "string" && v.trim() === ""),
      );
      if (entries.length === 0) continue;
      if (UNGROUPED_CATEGORIES.has(cat)) {
        ungrouped.push(...entries);
      } else {
        groups.push({ category: cat, entries });
      }
    }
  }

  if (ungrouped.length > 0) {
    groups.unshift({ category: "", entries: ungrouped });
  }
  return groups;
}
