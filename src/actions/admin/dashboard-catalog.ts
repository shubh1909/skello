"use server";

import { z } from "zod";

import { requireAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionResult, fail, ok } from "@/types/action";
import type {
  SourceCatalogColumn,
  SourceCatalogEntry,
} from "@/types/dashboard-widget";

// Drives the admin builder UI's dropdowns. Returns a per-org catalogue
// of {source: leads/calls/campaigns} with the columns that can appear
// as dimensions, filters, and metric inputs.
//
// The lists here are kept in sync with the SQL-side allowlists in
// migration 20260528000002 — if you add a column there, add it here
// too so the builder can offer it. Both layers gate independently;
// the UI list is for ergonomics, the SQL allowlist is for safety.

const inputSchema = z.object({
  organisation_id: z.string().uuid(),
});

const LEADS_DIMENSIONS: SourceCatalogColumn[] = [
  { key: "status", label: "Status", data_type: "enum" },
  { key: "current_intent", label: "Intent", data_type: "enum" },
  { key: "source", label: "Source", data_type: "enum" },
  { key: "pending_action", label: "Pending action", data_type: "boolean" },
  { key: "city", label: "City", data_type: "string" },
  { key: "pincode", label: "Pincode", data_type: "string" },
  {
    key: "created_at",
    label: "Captured at",
    data_type: "date",
    time_bucketable: true,
  },
  {
    key: "updated_at",
    label: "Updated at",
    data_type: "date",
    time_bucketable: true,
  },
];

const LEADS_FILTERABLES: SourceCatalogColumn[] = LEADS_DIMENSIONS;

const LEADS_METRIC_COLUMNS: SourceCatalogColumn[] = [
  { key: "id", label: "Lead rows", data_type: "string" },
  {
    key: "phone_normalized",
    label: "Unique phones",
    data_type: "string",
  },
];

const CALLS_DIMENSIONS: SourceCatalogColumn[] = [
  { key: "direction", label: "Direction", data_type: "enum" },
  { key: "status", label: "Status", data_type: "enum" },
  { key: "agent_id", label: "Agent", data_type: "string" },
  { key: "language", label: "Language", data_type: "string" },
  {
    key: "lead_intent_extracted",
    label: "Intent (extracted)",
    data_type: "enum",
  },
  {
    key: "customer_status",
    label: "Customer type",
    data_type: "string",
  },
  {
    key: "started_at",
    label: "Started at",
    data_type: "date",
    time_bucketable: true,
  },
];

const CALLS_FILTERABLES: SourceCatalogColumn[] = [
  ...CALLS_DIMENSIONS,
  {
    key: "duration_seconds",
    label: "Duration (sec)",
    data_type: "number",
  },
];

const CALLS_METRIC_COLUMNS: SourceCatalogColumn[] = [
  { key: "id", label: "Call rows", data_type: "string" },
  { key: "lead_id", label: "Unique leads", data_type: "string" },
  { key: "agent_id", label: "Unique agents", data_type: "string" },
  {
    key: "duration_seconds",
    label: "Duration (sec)",
    data_type: "number",
    numeric_metric: true,
  },
];

const CAMPAIGNS_DIMENSIONS: SourceCatalogColumn[] = [
  { key: "status", label: "Status", data_type: "enum" },
  {
    key: "created_at",
    label: "Created at",
    data_type: "date",
    time_bucketable: true,
  },
];

const CAMPAIGNS_FILTERABLES: SourceCatalogColumn[] = [
  ...CAMPAIGNS_DIMENSIONS,
  {
    key: "total_contacts",
    label: "Total contacts",
    data_type: "number",
  },
  {
    key: "valid_contacts",
    label: "Valid contacts",
    data_type: "number",
  },
  {
    key: "succeeded_count",
    label: "Succeeded",
    data_type: "number",
  },
  { key: "failed_count", label: "Failed", data_type: "number" },
  {
    key: "in_flight_count",
    label: "In-flight",
    data_type: "number",
  },
];

const CAMPAIGNS_METRIC_COLUMNS: SourceCatalogColumn[] = [
  { key: "id", label: "Campaign rows", data_type: "string" },
  {
    key: "total_contacts",
    label: "Total contacts",
    data_type: "number",
    numeric_metric: true,
  },
  {
    key: "valid_contacts",
    label: "Valid contacts",
    data_type: "number",
    numeric_metric: true,
  },
  {
    key: "succeeded_count",
    label: "Succeeded",
    data_type: "number",
    numeric_metric: true,
  },
  {
    key: "failed_count",
    label: "Failed",
    data_type: "number",
    numeric_metric: true,
  },
  {
    key: "in_flight_count",
    label: "In-flight",
    data_type: "number",
    numeric_metric: true,
  },
];

// Shopify cart-recovery attempts (table: shopify_recovery_attempts). Kept in
// sync with the SQL allowlists in migration 20260702000000.
const RECOVERY_DIMENSIONS: SourceCatalogColumn[] = [
  { key: "status", label: "Status", data_type: "enum" },
  { key: "skip_reason", label: "Skip reason", data_type: "enum" },
  { key: "currency", label: "Currency", data_type: "string" },
  {
    key: "created_at",
    label: "Abandoned at",
    data_type: "date",
    time_bucketable: true,
  },
  {
    key: "converted_at",
    label: "Recovered at",
    data_type: "date",
    time_bucketable: true,
  },
];

const RECOVERY_FILTERABLES: SourceCatalogColumn[] = [
  ...RECOVERY_DIMENSIONS,
  { key: "marketing_consent", label: "Marketing consent", data_type: "boolean" },
  { key: "cart_total", label: "Cart value", data_type: "number" },
];

const RECOVERY_METRIC_COLUMNS: SourceCatalogColumn[] = [
  { key: "id", label: "Cart rows", data_type: "string" },
  {
    key: "cart_total",
    label: "Cart value",
    data_type: "number",
    numeric_metric: true,
  },
  {
    key: "attempt",
    label: "Call attempts",
    data_type: "number",
    numeric_metric: true,
  },
];

export async function getDashboardSourceCatalog(
  input: unknown,
): Promise<ActionResult<SourceCatalogEntry[]>> {
  await requireAdmin();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();

  // Pull the org's custom fields so the leads source can offer them
  // as dimensions and filters. Calls / campaigns are first-class only
  // for Phase 1 — extending custom fields to calls would mean
  // mirroring the lead_field_definitions table per-source, which is
  // a bigger schema change.
  const { data: leadFields, error: fieldsErr } = await admin
    .from("lead_field_definitions")
    .select("source_column, category, key_path, label, data_type, enum_options")
    .eq("organisation_id", parsed.data.organisation_id)
    .returns<
      Array<{
        source_column: "lead_data" | "custom_data" | "column";
        category: string | null;
        key_path: string;
        label: string | null;
        data_type: SourceCatalogColumn["data_type"];
        enum_options: string[] | null;
      }>
    >();
  if (fieldsErr) return fail(fieldsErr.message);

  // First-class catalog fields (source_column = 'column') merge into
  // the built-in LEADS_DIMENSIONS as long as they aren't already
  // present — admin can add catalog rows for columns the platform
  // ships out of the box and we don't want a duplicate entry.
  const leadDimensionMap = new Map<string, SourceCatalogColumn>(
    LEADS_DIMENSIONS.map((c) => [`column:${c.key}`, c]),
  );
  const leadFilterMap = new Map<string, SourceCatalogColumn>(
    LEADS_FILTERABLES.map((c) => [`column:${c.key}`, c]),
  );

  for (const f of leadFields ?? []) {
    // Dedup key MUST match the format used to seed the maps above. A
    // first-class column (source_column = 'column') is identified by its
    // key_path alone — `column:<key>` — so re-declaring a built-in column
    // overwrites it instead of producing a second entry with the same
    // `.key` (which rendered duplicate dropdown items + React key warnings).
    // JSONB-source fields stay namespaced so `lead_data` / `custom_data`
    // keys can't clash with a first-class column.
    const idKey =
      f.source_column === "column"
        ? `column:${f.key_path}`
        : `${f.source_column}:${f.category ?? ""}:${f.key_path}`;
    const label = f.label ?? humanise(f.key_path);
    const enumOpts = f.enum_options ?? undefined;
    const column: SourceCatalogColumn = {
      key:
        f.source_column === "column"
          ? f.key_path
          : // JSONB-source dimensions are namespaced so the UI can
            // distinguish "interest" on lead_data from "interest" on
            // a first-class column.
            `${f.source_column}:${f.category ?? ""}:${f.key_path}`,
      label,
      data_type: f.data_type,
      enum_options: enumOpts,
      time_bucketable: f.data_type === "date",
    };
    leadDimensionMap.set(idKey, column);
    leadFilterMap.set(idKey, column);
  }

  const catalog: SourceCatalogEntry[] = [
    {
      source: "leads",
      label: "Leads",
      description: "One row per lead in the workspace.",
      dimensions: Array.from(leadDimensionMap.values()),
      filterables: Array.from(leadFilterMap.values()),
      metric_columns: LEADS_METRIC_COLUMNS,
    },
    {
      source: "calls",
      label: "Calls",
      description:
        "Inbound + outbound calls. Test calls are excluded automatically.",
      dimensions: CALLS_DIMENSIONS,
      filterables: CALLS_FILTERABLES,
      metric_columns: CALLS_METRIC_COLUMNS,
    },
    {
      source: "campaigns",
      label: "Campaigns",
      description: "Bulk outbound batches with their progress counters.",
      dimensions: CAMPAIGNS_DIMENSIONS,
      filterables: CAMPAIGNS_FILTERABLES,
      metric_columns: CAMPAIGNS_METRIC_COLUMNS,
    },
    {
      source: "recovery",
      label: "Cart Recovery",
      description:
        "Shopify abandoned-cart recovery attempts (cart value, status, outcomes).",
      dimensions: RECOVERY_DIMENSIONS,
      filterables: RECOVERY_FILTERABLES,
      metric_columns: RECOVERY_METRIC_COLUMNS,
    },
  ];

  return ok(catalog);
}

function humanise(key: string): string {
  return key
    .split("_")
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}
