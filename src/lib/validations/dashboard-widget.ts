import { z } from "zod";

// Shared schemas for the dashboard builder feature. Defined in lib/
// (not actions/) so Server Action files can import the types without
// tripping the "use server" exports-must-be-async constraint.
//
// The same schemas are validated again server-side by the Postgres RPC
// `execute_dashboard_widget` via its allowlist functions — Zod here is
// for friendly errors in the admin builder UI, the SQL allowlists are
// the security boundary.

export const widgetSourceSchema = z.enum([
  "leads",
  "calls",
  "campaigns",
  "recovery",
]);
export type WidgetSource = z.infer<typeof widgetSourceSchema>;

export const widgetMetricOpSchema = z.enum([
  "count",
  "count_distinct",
  "sum",
  "avg",
  "min",
  "max",
]);
export type WidgetMetricOp = z.infer<typeof widgetMetricOpSchema>;

export const widgetChartTypeSchema = z.enum([
  "stat_card",
  "bar",
  "pie",
  "line",
  "pivot",
]);
export type WidgetChartType = z.infer<typeof widgetChartTypeSchema>;

export const widgetRangeSchema = z.enum([
  "last_7_days",
  "last_30_days",
  "last_90_days",
  "last_180_days",
  "last_365_days",
  "all",
]);
export type WidgetRange = z.infer<typeof widgetRangeSchema>;

export const widgetDimensionSourceSchema = z.enum([
  "column",
  "lead_data",
  "custom_data",
]);

export const widgetTimeBucketSchema = z.enum(["day", "week", "month"]);
export type WidgetTimeBucket = z.infer<typeof widgetTimeBucketSchema>;

// A single dimension (row or column). `bucket` only applies when the
// referenced column is a timestamp (e.g. created_at) and we're building
// a time-series widget. JSONB-key dimensions (lead_data / custom_data)
// only work when source = 'leads' on the parent widget; the RPC drops
// the dimension silently otherwise so the renderer falls back to NULL.
export const widgetDimensionSchema = z.object({
  source: widgetDimensionSourceSchema,
  category: z.string().max(100).optional(),
  key: z.string().min(1).max(200),
  bucket: widgetTimeBucketSchema.optional(),
});
export type WidgetDimension = z.infer<typeof widgetDimensionSchema>;

// Reuses the same operator set as the leads-table filter chips so an
// admin's mental model is consistent across surfaces.
export const widgetFilterSchema = z.object({
  source: widgetDimensionSourceSchema.default("column"),
  category: z.string().max(100).optional(),
  key: z.string().min(1).max(200),
  op: z
    .enum(["eq", "neq", "contains", "lt", "lte", "gt", "gte"])
    .default("eq"),
  value: z.union([z.string(), z.number(), z.boolean()]),
});
export type WidgetFilter = z.infer<typeof widgetFilterSchema>;

export const widgetMetricSchema = z.object({
  op: widgetMetricOpSchema,
  // Required for sum/avg/min/max/count_distinct; ignored for plain count.
  column: z.string().min(1).max(200).optional(),
});
export type WidgetMetric = z.infer<typeof widgetMetricSchema>;

// The full widget config. Stored as JSONB in org_dashboard_widgets.config.
//
// Chart shape rules enforced by the .superRefine below:
//   * stat_card : both dimensions absent
//   * bar / pie : row_dimension required, column_dimension absent
//   * line      : row_dimension required AND must be a time-bucketed
//                 dimension (bucket is one of day/week/month)
//   * pivot     : both row_dimension and column_dimension required
export const builderWidgetConfigSchema = z
  .object({
    // Discriminates builder widgets from SQL widgets in the union below.
    // Defaulted so configs written before this field existed still parse.
    kind: z.literal("builder").default("builder"),
    source: widgetSourceSchema,
    metric: widgetMetricSchema,
    row_dimension: widgetDimensionSchema.optional(),
    column_dimension: widgetDimensionSchema.optional(),
    range: widgetRangeSchema.default("last_30_days"),
    filters: z.array(widgetFilterSchema).max(20).default([]),
    chart_type: widgetChartTypeSchema,
  })
  .superRefine((cfg, ctx) => {
    const hasRow = !!cfg.row_dimension;
    const hasCol = !!cfg.column_dimension;
    switch (cfg.chart_type) {
      case "stat_card":
        if (hasRow || hasCol) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Stat cards have no dimensions.",
          });
        }
        break;
      case "bar":
      case "pie":
        if (!hasRow) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${cfg.chart_type} charts need a row dimension.`,
          });
        }
        if (hasCol) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${cfg.chart_type} charts ignore the column dimension.`,
          });
        }
        break;
      case "line":
        if (!hasRow) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Line charts need a row dimension (time bucketed).",
          });
        } else if (!cfg.row_dimension?.bucket) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Line charts need a time bucket (day/week/month) on the row dimension.",
          });
        }
        if (hasCol) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Line charts ignore the column dimension.",
          });
        }
        break;
      case "pivot":
        if (!hasRow || !hasCol) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Pivot tables need both a row and a column dimension.",
          });
        }
        break;
    }
    // Metric op vs column sanity. count never needs a column; everything
    // else does. The Postgres allowlist rejects bad columns server-side,
    // but flagging it client-side gives a friendlier error.
    if (cfg.metric.op !== "count" && !cfg.metric.column) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${cfg.metric.op} needs a metric column.`,
      });
    }
  });
export type BuilderWidgetConfig = z.infer<typeof builderWidgetConfigSchema>;

// ---------------------------------------------------------------------------
// SQL widgets — admin-authored, constrained read-only SELECT.
// ---------------------------------------------------------------------------
// A platform admin writes a single SELECT (or WITH … SELECT). It is executed
// by the `execute_dashboard_sql` RPC (security invoker, so RLS on the source
// tables scopes the result to the calling org; statement-timeout + hard row
// cap; single-statement; SELECT-only). The query must return three columns
// in order: a text label, a text group (or NULL), and a numeric value — the
// same (dim_a, dim_b, value) contract the chart renderers already consume.
//
// This guard is the friendly client-side gate; the RPC re-checks the exact
// same rules in SQL (defence in depth — the SQL layer is the real boundary).
const SQL_FORBIDDEN =
  /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|comment|copy|vacuum|analyze|reindex|refresh|call|do|merge|lock|listen|notify|prepare|deallocate|discard|set|reset|begin|commit|rollback|savepoint|into|attach|detach)\b/i;

export function sqlSelectOnlyError(raw: string): string | null {
  const sql = raw.trim().replace(/;\s*$/, "");
  if (!sql) return "SQL is required.";
  if (sql.includes(";")) {
    return "Only a single statement is allowed (remove the ';').";
  }
  if (!/^(select|with)\b/i.test(sql)) {
    return "Query must start with SELECT or WITH.";
  }
  if (SQL_FORBIDDEN.test(sql)) {
    return "Only read-only SELECT is allowed — a write/DDL/session keyword was found.";
  }
  return null;
}

export const sqlWidgetConfigSchema = z.object({
  kind: z.literal("sql"),
  sql: z
    .string()
    .trim()
    .min(1, "SQL is required.")
    .max(5000, "SQL is too long (max 5000 characters).")
    .superRefine((val, ctx) => {
      const err = sqlSelectOnlyError(val);
      if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, message: err });
    }),
  chart_type: widgetChartTypeSchema,
});
export type SqlWidgetConfig = z.infer<typeof sqlWidgetConfigSchema>;

// Stored `config` JSONB is one of the two shapes. SQL first so a SQL config
// reports its own (more specific) errors; a builder config lacks
// kind:"sql"/source and falls through to the builder branch.
export const widgetConfigSchema = z.union([
  sqlWidgetConfigSchema,
  builderWidgetConfigSchema,
]);
export type WidgetConfig = z.infer<typeof widgetConfigSchema>;

export function isSqlWidgetConfig(cfg: WidgetConfig): cfg is SqlWidgetConfig {
  return (cfg as { kind?: string }).kind === "sql";
}

// Admin-action payloads.

export const widgetCreateSchema = z.object({
  organisation_id: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  config: widgetConfigSchema,
  position: z.number().int().min(0).max(1000).optional(),
  enabled: z.boolean().default(true),
});
export type WidgetCreateInput = z.infer<typeof widgetCreateSchema>;

export const widgetUpdateSchema = z.object({
  id: z.string().uuid(),
  organisation_id: z.string().uuid(),
  title: z.string().trim().min(1).max(120).optional(),
  config: widgetConfigSchema.optional(),
  enabled: z.boolean().optional(),
});
export type WidgetUpdateInput = z.infer<typeof widgetUpdateSchema>;

export const widgetReorderSchema = z.object({
  organisation_id: z.string().uuid(),
  // Array of widget IDs in their new display order. Indexes become
  // `position` server-side.
  ordered_ids: z.array(z.string().uuid()).min(1).max(50),
});
export type WidgetReorderInput = z.infer<typeof widgetReorderSchema>;

export const widgetDeleteSchema = z.object({
  id: z.string().uuid(),
  organisation_id: z.string().uuid(),
});
export type WidgetDeleteInput = z.infer<typeof widgetDeleteSchema>;

// Runtime row contract from execute_dashboard_widget. Three fixed cols.
export interface WidgetExecuteRow {
  dim_a: string | null;
  dim_b: string | null;
  value: number;
}
