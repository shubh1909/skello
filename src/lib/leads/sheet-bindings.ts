import { UNGROUPED_CATEGORIES } from "@/lib/csv-custom-fields";
import { formatOutcomeKey as titleCaseKey } from "@/lib/format";
import { isEmptyValue } from "@/lib/format/empty";
import { APP_TIMEZONE } from "@/lib/time";
import type { Lead } from "@/types/lead";
import type {
  LeadSheetBinding,
  LeadSheetFormat,
  LeadSheetSlot,
} from "@/types/lead-sheet-binding";

/**
 * Turning an admin's binding into something to draw.
 *
 * Pure and client-safe on purpose: the sheet renders these, and the same
 * functions are unit-tested without a database. Nothing here reads config —
 * the caller supplies both the bindings and the lead.
 *
 * Locale and timezone are pinned for the same reason they are in
 * `lib/format/recovery.ts`: these strings are produced during SSR and again on
 * hydration, and an environment-dependent format produces two different strings
 * for one value, which React reports as a hydration mismatch.
 */
const LOCALE = "en-IN";

/** Per-lead call aggregates. Supplied by the caller, never queried here. */
export interface LeadCallStats {
  inbound_calls: number;
  outbound_calls: number;
  total_calls: number;
  last_call_at: string | null;
  first_call_at: string | null;
  /** Duration of the most recent call, for the "last contact" panel. */
  last_call_duration_seconds: number | null;
}

/** The lead columns a `column` binding may address. */
type LeadColumns = Pick<
  Lead,
  | "name"
  | "phone"
  | "city"
  | "pincode"
  | "notes"
  | "source"
  | "status"
  | "current_intent"
  | "current_intent_score"
  | "owner_label"
  | "pending_action"
  | "created_at"
  | "first_seen_at"
  | "last_contact_at"
>;

export interface BindingSource {
  lead: LeadColumns;
  /** Effective lead_data — lead row first, call snapshots filling gaps. */
  leadData: Record<string, unknown> | null;
  customData: Record<string, Record<string, unknown>> | null;
  stats: LeadCallStats;
}

export interface ResolvedBinding {
  id: string;
  slot: LeadSheetSlot;
  slot_position: number;
  label: string;
  format: LeadSheetFormat;
  /** The value before formatting — the badge renderer wants the raw enum. */
  raw: unknown;
  /** Formatted for display. Never an empty string; null means "hide me". */
  display: string | null;
  caption: string | null;
}

/**
 * The allowlist for `column` bindings.
 *
 * A map, not a dynamic property read, because `key_path` is admin-authored
 * text. `lead[binding.key_path]` would happily return `organisation_id` or walk
 * into whatever else the object carries; an unlisted key here resolves to
 * undefined and the binding hides itself.
 *
 * Keys match the leads-table catalog (`lead_field_definitions` rows with
 * `source_column = 'column'`) so the admin picker and this resolver agree on
 * what "a column" means.
 */
const COLUMN_READERS: Record<string, (s: BindingSource) => unknown> = {
  name: (s) => s.lead.name,
  phone: (s) => s.lead.phone,
  city: (s) => s.lead.city,
  pincode: (s) => s.lead.pincode,
  notes: (s) => s.lead.notes,
  source: (s) => s.lead.source,
  status: (s) => s.lead.status,
  current_intent: (s) => s.lead.current_intent,
  current_intent_score: (s) => s.lead.current_intent_score,
  owner_label: (s) => s.lead.owner_label,
  pending_action: (s) => s.lead.pending_action,
  created_at: (s) => s.lead.created_at,
  first_seen_at: (s) => s.lead.first_seen_at,
  last_contact_at: (s) => s.lead.last_contact_at,
  inbound_calls: (s) => s.stats.inbound_calls,
  outbound_calls: (s) => s.stats.outbound_calls,
  total_calls: (s) => s.stats.total_calls,
  last_call_at: (s) => s.stats.last_call_at,
  first_call_at: (s) => s.stats.first_call_at,
  last_call_duration_seconds: (s) => s.stats.last_call_duration_seconds,
};

/** Every `column` key an admin may bind. Drives the picker's options. */
export const BINDABLE_COLUMN_KEYS = Object.keys(COLUMN_READERS);

/**
 * Full names for the bindable columns, and which group they belong to in the
 * picker.
 *
 * These are NOT the labels from `lead_field_definitions`. Those are written for
 * a narrow table header — `inbound_calls` is labelled "In" and `outbound_calls`
 * "Out" — which is right above a column of numbers and useless in a dropdown
 * that offers thirty fields. "Lead · In" told an admin nothing.
 */
// Kept SHORT as well as clear: whatever is picked here becomes the slot's
// label when an admin doesn't type one, and a card headed "Intent — hot / warm
// / cold" wraps to three lines. The group heading supplies the context that
// would otherwise have to live in the option text.
export const BINDABLE_COLUMN_META: Record<
  string,
  { label: string; group: "lead" | "activity" }
> = {
  name: { label: "Name", group: "lead" },
  phone: { label: "Phone", group: "lead" },
  city: { label: "City", group: "lead" },
  pincode: { label: "Pincode", group: "lead" },
  notes: { label: "Description", group: "lead" },
  source: { label: "Source", group: "lead" },
  status: { label: "Pipeline status", group: "lead" },
  current_intent: { label: "Intent", group: "lead" },
  current_intent_score: { label: "Intent score", group: "lead" },
  owner_label: { label: "Owner", group: "lead" },
  pending_action: { label: "Needs attention", group: "lead" },
  created_at: { label: "Added to Skelo", group: "lead" },
  first_seen_at: { label: "First seen", group: "lead" },
  last_contact_at: { label: "Last touched", group: "lead" },
  inbound_calls: { label: "Calls received", group: "activity" },
  outbound_calls: { label: "Calls placed", group: "activity" },
  total_calls: { label: "Total calls", group: "activity" },
  last_call_at: { label: "Most recent call", group: "activity" },
  first_call_at: { label: "First call", group: "activity" },
  last_call_duration_seconds: {
    label: "Last call length",
    group: "activity",
  },
};

function readCustom(
  customData: Record<string, Record<string, unknown>> | null,
  category: string,
  key: string,
): unknown {
  if (!customData) return undefined;

  // The uncategorised bucket has three spellings in live data: '' is canonical
  // (what apply_lead_field_jsonb writes), '__general__' and 'general' are
  // legacy webhook payloads that pre-date that decision. A binding authored
  // against one must not miss a lead stored under another.
  if (UNGROUPED_CATEGORIES.has(category)) {
    for (const alias of UNGROUPED_CATEGORIES) {
      const bag = customData[alias];
      if (bag && bag[key] !== undefined) return bag[key];
    }
    return undefined;
  }

  return customData[category]?.[key];
}

/** The raw value a binding address points at, or undefined. */
export function readBindingValue(
  source_column: LeadSheetBinding["source_column"],
  category: string,
  key_path: string,
  source: BindingSource,
): unknown {
  if (source_column === "column") {
    return COLUMN_READERS[key_path]?.(source);
  }
  if (source_column === "lead_data") {
    return source.leadData?.[key_path];
  }
  return readCustom(source.customData, category, key_path);
}

function formatDateOnly(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: APP_TIMEZONE,
  });
}

function formatDateAndTime(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: APP_TIMEZONE,
  });
}

/**
 * Render a raw value per the binding's format. Returns null for "nothing to
 * show", which the renderer treats as "hide this row" rather than drawing a
 * labelled blank.
 *
 * Every branch falls back to the raw string rather than to null when the value
 * doesn't fit the format. The agent's extraction is free text: a budget field
 * configured as `currency_inr` legitimately arrives as "80 L" or "1.2 Cr", and
 * showing what the customer said beats showing "—" because it wasn't a number.
 */
export function formatBindingValue(
  raw: unknown,
  format: LeadSheetFormat,
): string | null {
  if (isEmptyValue(raw)) return null;

  if (typeof raw === "boolean") {
    // Answers before formats: a boolean is Yes/No whatever the slot was
    // configured as, and "true" is not a thing to show a salesperson.
    return raw ? "Yes" : "No";
  }

  const asString = String(raw).trim();
  if (asString === "") return null;

  switch (format) {
    case "number": {
      const n = Number(asString);
      return Number.isFinite(n) ? n.toLocaleString(LOCALE) : asString;
    }
    case "currency_inr": {
      const n = Number(asString.replace(/[,\s₹]/g, ""));
      if (!Number.isFinite(n)) return asString;
      return new Intl.NumberFormat(LOCALE, {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(n);
    }
    case "date":
      return formatDateOnly(asString) ?? asString;
    case "datetime":
      return formatDateAndTime(asString) ?? asString;
    case "boolean": {
      const lower = asString.toLowerCase();
      if (["yes", "true", "1"].includes(lower)) return "Yes";
      if (["no", "false", "0"].includes(lower)) return "No";
      return asString;
    }
    case "enum_badge":
      return titleCaseKey(asString);
    case "text":
    default:
      return asString;
  }
}

/**
 * Resolve one binding against one lead.
 *
 * Returns null when the value is absent — an org whose agent never emits
 * `interest` should see a shorter panel, not a labelled empty row. A stat card
 * with a static caption is the deliberate exception handled by the caller: the
 * card row keeps its shape, so an unresolvable card renders a dash.
 */
export function resolveBinding(
  binding: LeadSheetBinding,
  source: BindingSource,
): ResolvedBinding | null {
  const raw = readBindingValue(
    binding.source_column,
    binding.category,
    binding.key_path,
    source,
  );
  const display = formatBindingValue(raw, binding.format);
  if (display === null) return null;

  let caption: string | null = binding.caption_static?.trim() || null;
  if (!caption && binding.caption_source_column && binding.caption_key_path) {
    const captionRaw = readBindingValue(
      binding.caption_source_column,
      binding.caption_category,
      binding.caption_key_path,
      source,
    );
    caption = formatBindingValue(captionRaw, "text");
  }

  return {
    id: binding.id,
    slot: binding.slot,
    slot_position: binding.slot_position,
    label: binding.label,
    format: binding.format,
    raw,
    display,
    caption,
  };
}

/**
 * Resolve every binding for one slot, in position order.
 *
 * `keepUnresolved` is for the stat-card row, which must keep its three-column
 * shape even when a card has no value — a row that silently shrinks from three
 * cards to one reads as a layout bug, not as missing data.
 */
export function resolveSlot(
  bindings: readonly LeadSheetBinding[],
  slot: LeadSheetSlot,
  source: BindingSource,
  keepUnresolved = false,
): ResolvedBinding[] {
  return bindings
    .filter((b) => b.slot === slot)
    .sort((a, b) => a.slot_position - b.slot_position)
    .map((b) => {
      const resolved = resolveBinding(b, source);
      if (resolved) return resolved;
      if (!keepUnresolved) return null;
      return {
        id: b.id,
        slot: b.slot,
        slot_position: b.slot_position,
        label: b.label,
        format: b.format,
        raw: null,
        display: null,
        caption: b.caption_static?.trim() || null,
      } satisfies ResolvedBinding;
    })
    .filter((r): r is ResolvedBinding => r !== null);
}

/** Call aggregates from a lead's calls, newest-first. */
export function statsFromCalls(
  calls: readonly {
    direction: "inbound" | "outbound";
    started_at: string | null;
    duration_seconds: number | null;
  }[],
): LeadCallStats {
  let inbound = 0;
  let outbound = 0;
  let last: string | null = null;
  let first: string | null = null;
  let lastDuration: number | null = null;

  for (const c of calls) {
    if (c.direction === "inbound") inbound++;
    else outbound++;
    if (!c.started_at) continue;
    // ISO-8601 sorts lexicographically, so string comparison is date order.
    if (last === null || c.started_at > last) {
      last = c.started_at;
      lastDuration = c.duration_seconds;
    }
    if (first === null || c.started_at < first) first = c.started_at;
  }

  return {
    inbound_calls: inbound,
    outbound_calls: outbound,
    total_calls: calls.length,
    last_call_at: last,
    first_call_at: first,
    last_call_duration_seconds: lastDuration,
  };
}
