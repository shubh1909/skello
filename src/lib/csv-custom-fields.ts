// Shared "flatten a lead/call's JSONB blobs into discoverable CSV
// columns" logic, originally written for the conversations export. Both
// the leads export and the calls export need to:
//   (a) walk every row's lead_data + custom_data
//   (b) collect a stable, sorted list of (source, category, key) tuples
//   (c) generate one CSV column per tuple, skipping keys that already
//       have a dedicated column (so the same value doesn't appear twice).
// Keeping this in one place stops the two exports from quietly drifting
// on what counts as an "ungrouped" category or how to humanise a key.

export type CustomFieldSource = "lead_data" | "custom_data";

export interface DiscoveredCustomField {
  header: string;
  source: CustomFieldSource;
  category: string; // "" for ungrouped (flat) custom_data and all lead_data
  key: string;
}

// Carry just the JSONB columns we care about — both lead rows and call
// rows happen to expose these under the same property names, so a
// single structural type covers both export contexts.
export interface CustomFieldsCarrier {
  lead_data: Record<string, unknown> | null;
  custom_data: Record<string, Record<string, unknown>> | null;
}

// Categories that should render their keys at the top level without a
// "Category > Key" prefix. The empty string is the canonical convention
// from `apply_lead_field_jsonb`; the named aliases are legacy webhook
// payloads that pre-date that decision.
export const UNGROUPED_CATEGORIES = new Set(["", "__general__", "general"]);

export function humaniseFieldKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

export function stringifyCustomValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return null;
    const lower = t.toLowerCase();
    if (lower === "yes" || lower === "true") return "Yes";
    if (lower === "no" || lower === "false") return "No";
    return t;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((v) => stringifyCustomValue(v))
      .filter((v): v is string => v !== null);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

// Walk every exported row and collect each (source, category, key) tuple
// that carries data, so each one can become its own CSV column. The
// `surfacedLeadDataKeys` set lets callers exclude lead_data keys that
// already get a dedicated static column (e.g. "Interest", "Customer
// Type") so the same value doesn't appear twice. The output is sorted
// by header for stable column ordering across exports.
export function discoverCustomFields(
  rows: CustomFieldsCarrier[],
  surfacedLeadDataKeys: ReadonlySet<string> = new Set(),
): DiscoveredCustomField[] {
  const seen = new Map<string, DiscoveredCustomField>();

  for (const row of rows) {
    if (row.lead_data) {
      for (const k of Object.keys(row.lead_data)) {
        if (surfacedLeadDataKeys.has(k)) continue;
        const mapKey = `lead_data::${k}`;
        if (seen.has(mapKey)) continue;
        seen.set(mapKey, {
          header: humaniseFieldKey(k),
          source: "lead_data",
          category: "",
          key: k,
        });
      }
    }
    if (row.custom_data) {
      for (const [cat, bag] of Object.entries(row.custom_data)) {
        if (!bag || typeof bag !== "object") continue;
        const isUngrouped = UNGROUPED_CATEGORIES.has(cat);
        const catLabel = isUngrouped ? null : humaniseFieldKey(cat);
        for (const k of Object.keys(bag)) {
          const mapKey = `custom_data::${cat}::${k}`;
          if (seen.has(mapKey)) continue;
          seen.set(mapKey, {
            header: catLabel
              ? `${catLabel} > ${humaniseFieldKey(k)}`
              : humaniseFieldKey(k),
            source: "custom_data",
            category: cat,
            key: k,
          });
        }
      }
    }
  }

  return Array.from(seen.values()).sort((a, b) =>
    a.header.localeCompare(b.header),
  );
}

export function pickCustomFieldValue(
  row: CustomFieldsCarrier,
  f: DiscoveredCustomField,
): unknown {
  if (f.source === "lead_data") {
    return row.lead_data?.[f.key] ?? null;
  }
  const bag = row.custom_data?.[f.category];
  if (!bag || typeof bag !== "object") return null;
  return bag[f.key] ?? null;
}
