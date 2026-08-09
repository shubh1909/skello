import {
  fromLocalDateTimeInput,
  toLocalDateTimeInputValue,
} from "@/lib/format";
import type { Lead } from "@/types/lead";
import type { LeadFieldDefinition } from "@/types/lead-field-definition";

/**
 * The catalog-driven editor for a lead's JSONB-backed fields
 * (`lead_data` + `custom_data`): which fields are editable, how a stored value
 * becomes an input value, and how the form becomes a patch.
 */

/**
 * `lead_data` key_paths the main details form already owns.
 *
 * Without this the same field renders twice in the sheet, and — worse — both
 * copies write to the same key. Keep in sync with `splitWrites()` in
 * `src/actions/leads.ts`.
 */
const DETAILS_FORM_LEAD_DATA_KEYS = new Set<string>([
  "interest",
  "customer_status",
  "connect_on_whatsapp",
  "date_and_time_of_visit",
]);

export function pickEditableCatalog(
  catalog: readonly LeadFieldDefinition[],
): LeadFieldDefinition[] {
  return catalog
    .filter((d) => {
      // `column` fields are real table columns — the details form edits those.
      if (d.source_column === "column") return false;
      if (
        d.source_column === "lead_data" &&
        DETAILS_FORM_LEAD_DATA_KEYS.has(d.key_path)
      ) {
        return false;
      }
      return true;
    })
    .slice()
    .sort((a, b) => {
      // Category first (the empty one sorts first, so flat lead_data keys
      // lead), then
      // display_order, then label so the order is stable across renders.
      const cat = (a.category ?? "").localeCompare(b.category ?? "");
      if (cat !== 0) return cat;
      if (a.display_order !== b.display_order) {
        return a.display_order - b.display_order;
      }
      return (a.label ?? a.key_path).localeCompare(b.label ?? b.key_path);
    });
}

/**
 * Keyed by catalog field **id**, not key_path — two categories can carry the
 * same key. Values are raw input strings ("true"/"false"/"" for booleans);
 * coercion to the wire type happens in `diffCapturedForm`, which keeps the
 * input components dumb.
 */
export type CapturedForm = Record<string, string>;

export function readCatalogValue(
  def: LeadFieldDefinition,
  leadData: Record<string, unknown> | null | undefined,
  customData: Record<string, unknown> | null | undefined,
): unknown {
  if (def.source_column === "lead_data") {
    return leadData?.[def.key_path] ?? null;
  }
  if (!customData) return null;
  const category = def.category ?? "";
  if (category === "") {
    // Flat top-level scalar — the `apply_lead_field_jsonb` convention for an
    // ungrouped category. Objects are refused here: if the key collides with a
    // named category we'd otherwise hand back a whole nested bag as a value.
    const candidate = customData[def.key_path];
    if (candidate !== null && typeof candidate === "object") return null;
    return candidate ?? null;
  }
  const bag = customData[category];
  if (!bag || typeof bag !== "object" || Array.isArray(bag)) return null;
  return (bag as Record<string, unknown>)[def.key_path] ?? null;
}

export function rawToFormValue(
  value: unknown,
  def: LeadFieldDefinition,
): string {
  if (value === null || value === undefined) return "";
  if (def.data_type === "boolean") {
    if (value === true) return "true";
    if (value === false) return "false";
    // Extractors send booleans as words often enough to be worth handling.
    if (typeof value === "string") {
      const lc = value.toLowerCase();
      if (["true", "yes", "1"].includes(lc)) return "true";
      if (["false", "no", "0"].includes(lc)) return "false";
    }
    return "";
  }
  if (def.data_type === "date") {
    const iso = typeof value === "string" ? value : null;
    if (!iso) return "";
    try {
      return toLocalDateTimeInputValue(iso);
    } catch {
      return "";
    }
  }
  if (def.data_type === "number") {
    return String(value);
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Seed the form from the lead row, falling back to the call-backfilled view.
 *
 * The fallback exists so the form prefills with **what the operator was just
 * looking at** — the read view shows backfilled values, and an Edit button that
 * blanked them would look like data loss.
 *
 * ⚠️ The fallback is only safe because `buildEffective*Data` is pinned to the
 * first page of calls. When it read the whole paged list, scrolling the Calls
 * tab before clicking Edit changed which keys prefilled — and therefore which
 * keys the save wrote. See `effective-data.ts`.
 *
 * The lead row is read directly rather than through the effective view because
 * the effective view drops flat ungrouped scalars during its dedupe pass.
 */
export function buildCapturedForm(
  fields: readonly LeadFieldDefinition[],
  leadData: Record<string, unknown> | null | undefined,
  customData: Record<string, unknown> | null | undefined,
  fallbackLeadData?: Record<string, unknown> | null,
  fallbackCustomData?: Record<string, Record<string, unknown>> | null,
): CapturedForm {
  const form: CapturedForm = {};
  for (const def of fields) {
    let value = readCatalogValue(def, leadData, customData);
    if (
      (value === null || value === "" || value === undefined) &&
      (fallbackLeadData || fallbackCustomData)
    ) {
      value = readCatalogValue(
        def,
        fallbackLeadData ?? null,
        fallbackCustomData ?? null,
      );
    }
    form[def.id] = rawToFormValue(value, def);
  }
  return form;
}

export function formValueToWire(
  value: string,
  def: LeadFieldDefinition,
): string | number | boolean | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (def.data_type === "boolean") {
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    return null;
  }
  if (def.data_type === "number") {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  if (def.data_type === "date") {
    try {
      return fromLocalDateTimeInput(trimmed);
    } catch {
      return null;
    }
  }
  return trimmed;
}

export interface CapturedFieldsPatch {
  lead_data_patch?: Record<string, string | number | boolean | null>;
  custom_data_patch?: Record<
    string,
    Record<string, string | number | boolean | null>
  >;
}

/**
 * Only what changed, diffed against the **lead row** — never against the
 * backfilled view. A field that only ever existed on a call snapshot therefore
 * shows as a change and gets promoted onto the lead, which is the intent: the
 * operator saw it, kept it, and saved.
 *
 * Current values are round-tripped through `rawToFormValue` before comparing,
 * so a stored `"yes"` and a form `"true"` don't read as a difference.
 */
export function diffCapturedForm(
  form: CapturedForm,
  fields: readonly LeadFieldDefinition[],
  lead: Pick<Lead, "lead_data" | "custom_data">,
): CapturedFieldsPatch {
  const patch: CapturedFieldsPatch = {};
  const ld: Record<string, string | number | boolean | null> = {};
  const cd: Record<
    string,
    Record<string, string | number | boolean | null>
  > = {};

  for (const def of fields) {
    const raw = form[def.id] ?? "";
    const next = formValueToWire(raw, def);
    const currentRaw = readCatalogValue(def, lead.lead_data, lead.custom_data);
    const currentWire = formValueToWire(rawToFormValue(currentRaw, def), def);
    if (next === currentWire) continue;
    if (def.source_column === "lead_data") {
      ld[def.key_path] = next;
    } else {
      const cat = def.category ?? "";
      (cd[cat] ??= {})[def.key_path] = next;
    }
  }

  if (Object.keys(ld).length > 0) patch.lead_data_patch = ld;
  if (Object.keys(cd).length > 0) patch.custom_data_patch = cd;
  return patch;
}

/** True when a patch would write nothing. */
export function isCapturedPatchEmpty(patch: CapturedFieldsPatch): boolean {
  return (
    Object.keys(patch.lead_data_patch ?? {}).length === 0 &&
    Object.keys(patch.custom_data_patch ?? {}).length === 0
  );
}
