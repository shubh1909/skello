import { z } from "zod";

// Filter + sort schemas shared between:
//   - the leads-activity Server Action (`listLeadsWithCallActivity`)
//   - the CSV export route (`/api/leads/export`)
//   - the export count preview route (`/api/leads/export/count`)
//
// They live in lib/ rather than actions/ because Next.js's "use server"
// files can only export async functions — non-function exports from a
// Server Action module fail at build time.

export const leadActivityFilterSchema = z.object({
  // "column" was added so the catalog-toggled first-class columns
  // (current_intent, pending_action, inbound_calls, etc.) can be filtered
  // through the same RPC path as JSONB fields. See migration
  // 20260520000001 for the allowlist of acceptable column keys.
  source: z
    .enum(["lead_data", "custom_data", "column"])
    .default("lead_data"),
  category: z.string().max(100).optional(),
  key: z.string().min(1).max(200),
  op: z.enum(["eq", "neq", "contains", "lt", "lte", "gt", "gte"]).default("eq"),
  // jsonb-safe scalar: string | number | boolean. Null isn't sent — empty
  // filters are dropped client-side.
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export const leadActivitySortBySchema = z.object({
  source: z.enum(["column", "lead_data", "custom_data"]),
  category: z.string().max(100).optional(),
  key: z.string().min(1).max(200),
  dir: z.enum(["asc", "desc"]).default("desc"),
  type: z.enum(["text", "number", "date", "boolean"]).default("text"),
});

export type LeadActivityFilter = z.infer<typeof leadActivityFilterSchema>;
export type LeadActivitySortBy = z.infer<typeof leadActivitySortBySchema>;
