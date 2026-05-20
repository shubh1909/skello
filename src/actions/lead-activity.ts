"use server";

import { z } from "zod";

import { logSkeloError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { orgSlugSchema } from "@/lib/validations/lead";
import { type ActionResult, fail, ok } from "@/types/action";
import type { Lead, LeadIntent } from "@/types/lead";

const filterSchema = z.object({
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

const sortBySchema = z.object({
  source: z.enum(["column", "lead_data", "custom_data"]),
  category: z.string().max(100).optional(),
  key: z.string().min(1).max(200),
  dir: z.enum(["asc", "desc"]).default("desc"),
  type: z.enum(["text", "number", "date", "boolean"]).default("text"),
});

const inputSchema = z.object({
  org_slug: orgSlugSchema,
  include_zero_calls: z.boolean().default(false),
  limit: z.number().int().min(1).max(1000).default(50),
  offset: z.number().int().min(0).default(0),
  filters: z.array(filterSchema).max(20).default([]),
  sort_by: sortBySchema.nullish(),
  search: z.string().trim().max(200).optional(),
});

const countInputSchema = z.object({
  org_slug: orgSlugSchema,
  include_zero_calls: z.boolean().default(false),
  filters: z.array(filterSchema).max(20).default([]),
  search: z.string().trim().max(200).optional(),
});

export type LeadActivityFilter = z.infer<typeof filterSchema>;
export type LeadActivitySortBy = z.infer<typeof sortBySchema>;

export interface LeadWithCallActivity extends Lead {
  inbound_calls: number;
  outbound_calls: number;
  total_calls: number;
  last_call_at: string | null;
  first_call_at: string | null;
  total_duration_seconds: number;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function pickJsonString(blob: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!blob) return null;
  const v = blob[key];
  if (typeof v === "string" && v.trim().length > 0) return v;
  return null;
}

function pickJsonBool(blob: Record<string, unknown> | null | undefined, key: string): boolean | null {
  if (!blob) return null;
  const v = blob[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const lower = v.toLowerCase().trim();
    if (["true", "yes", "1"].includes(lower)) return true;
    if (["false", "no", "0"].includes(lower)) return false;
  }
  return null;
}

function pickJsonDate(blob: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = pickJsonString(blob, key);
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

interface ActivityRow {
  id: string;
  created_at: string;
  updated_at: string;
  organisation_id: string;
  org_slug: string | null;
  name: string | null;
  phone: string | null;
  phone_normalized: string | null;
  first_seen_at: string | null;
  last_contact_at: string | null;
  current_intent: LeadIntent | null;
  city: string | null;
  pincode: string | null;
  notes: string | null;
  source: Lead["source"];
  status: Lead["status"];
  pending_action: boolean;
  lead_data: Record<string, unknown> | null;
  custom_data: Record<string, Record<string, unknown>> | null;
  latest_call_interest: string | null;
  latest_call_summary: string | null;
  latest_call_recording_url: string | null;
  inbound_calls: number | string;
  outbound_calls: number | string;
  total_calls: number | string;
  last_call_at: string | null;
  first_call_at: string | null;
  total_duration_seconds: number | string;
}

function buildActivity(row: ActivityRow): LeadWithCallActivity {
  const ld = row.lead_data ?? {};
  return {
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    organisation_id: row.organisation_id,
    org_slug: row.org_slug,
    phone: row.phone,
    phone_normalized: row.phone_normalized,
    first_seen_at: row.first_seen_at,
    last_contact_at: row.last_contact_at,
    name: row.name,
    current_intent: row.current_intent,
    city: row.city,
    pincode: row.pincode,
    notes: row.notes,
    status: row.status,
    pending_action: row.pending_action,
    source: row.source,
    lead_data: ld,
    custom_data: row.custom_data ?? {},
    lead_intent: row.current_intent,
    interest:
      pickJsonString(ld, "interest") ??
      pickJsonString(ld, "product") ??
      row.latest_call_interest,
    customer_status: pickJsonString(ld, "customer_status"),
    wants_to_connect_on_watsapp: pickJsonBool(ld, "connect_on_whatsapp"),
    visit_date_time: pickJsonDate(ld, "date_and_time_of_visit"),
    summary: row.latest_call_summary,
    actionable: null,
    recording_url: row.latest_call_recording_url,
    external_id: null,
    inbound_calls: toNumber(row.inbound_calls),
    outbound_calls: toNumber(row.outbound_calls),
    total_calls: toNumber(row.total_calls),
    last_call_at: row.last_call_at,
    first_call_at: row.first_call_at,
    total_duration_seconds: toNumber(row.total_duration_seconds),
  };
}

export async function listLeadsWithCallActivity(
  input: unknown,
): Promise<ActionResult<{ items: LeadWithCallActivity[]; total: number }>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { org_slug, include_zero_calls, limit, offset, filters, sort_by, search } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated");

  const { data: org } = await supabase
    .from("organisations")
    .select("id, slug")
    .eq("slug", org_slug)
    .eq("owner_id", user.id)
    .maybeSingle<{ id: string; slug: string }>();
  if (!org) return fail("Forbidden");

  const [itemsRes, countRes] = await Promise.all([
    supabase.rpc("lead_call_activity", {
      p_org_id: org.id,
      p_org_slug: org_slug,
      p_include_zero_calls: include_zero_calls,
      p_limit: limit,
      p_offset: offset,
      p_filters: filters,
      p_sort_by: sort_by ?? null,
      p_search: search ?? null,
    }),
    supabase.rpc("lead_call_activity_count", {
      p_org_id: org.id,
      p_org_slug: org_slug,
      p_include_zero_calls: include_zero_calls,
      p_filters: filters,
      p_search: search ?? null,
    }),
  ]);

  if (itemsRes.error) {
    return fail(
      logSkeloError("LEAD-READ-FAIL", "Lead activity query failed", {
        organisationId: org.id,
        cause: itemsRes.error,
      }),
    );
  }
  if (countRes.error) {
    return fail(
      logSkeloError("LEAD-READ-FAIL", "Lead activity count query failed", {
        organisationId: org.id,
        cause: countRes.error,
      }),
    );
  }

  const rows = (itemsRes.data ?? []) as ActivityRow[];
  const items = rows.map(buildActivity);
  return ok({ items, total: toNumber(countRes.data) });
}

export async function countLeadCallActivity(
  input: unknown,
): Promise<ActionResult<number>> {
  const parsed = countInputSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { org_slug, include_zero_calls, filters, search } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated");

  const { data: org } = await supabase
    .from("organisations")
    .select("id, slug")
    .eq("slug", org_slug)
    .eq("owner_id", user.id)
    .maybeSingle<{ id: string; slug: string }>();
  if (!org) return fail("Forbidden");

  const { data, error } = await supabase.rpc("lead_call_activity_count", {
    p_org_id: org.id,
    p_org_slug: org_slug,
    p_include_zero_calls: include_zero_calls,
    p_filters: filters,
    p_search: search ?? null,
  });

  if (error) {
    return fail(
      logSkeloError("LEAD-READ-FAIL", "Lead activity count failed", {
        organisationId: org.id,
        cause: error,
      }),
    );
  }
  return ok(toNumber(data));
}
