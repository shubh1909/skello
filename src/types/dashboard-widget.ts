import type { WidgetConfig } from "@/lib/validations/dashboard-widget";

// Row stored in public.org_dashboard_widgets. The TS layer keeps the
// JSONB config typed via WidgetConfig (validated by Zod on read), but
// the database doesn't enforce structural typing beyond `jsonb not null`.
export interface OrgDashboardWidget {
  id: string;
  organisation_id: string;
  position: number;
  enabled: boolean;
  title: string;
  config: WidgetConfig;
  created_at: string;
  updated_at: string;
}

// Catalogue entries shown in the admin builder UI. Drives the source/
// metric/dimension/filter dropdowns. Built from the SQL-side allowlists
// + the org's lead_field_definitions for the custom-field path.
export interface SourceCatalogColumn {
  key: string;
  label: string;
  data_type: "string" | "number" | "boolean" | "date" | "enum" | "unknown";
  enum_options?: string[];
  // When true the admin builder offers a time-bucket picker.
  time_bucketable?: boolean;
  // When true the column is usable as a metric (sum/avg/etc); count_distinct
  // always allows the id-like columns regardless.
  numeric_metric?: boolean;
}

export interface SourceCatalogEntry {
  source: "leads" | "calls" | "campaigns" | "recovery";
  label: string;
  description: string;
  // Columns available as dimensions / filters.
  dimensions: SourceCatalogColumn[];
  filterables: SourceCatalogColumn[];
  // Columns available as the metric column for sum/avg/min/max/count_distinct.
  metric_columns: SourceCatalogColumn[];
}
