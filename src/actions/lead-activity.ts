"use server";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { orgSlugSchema } from "@/lib/validations/lead";
import { type ActionResult, fail, ok } from "@/types/action";
import type { Lead } from "@/types/lead";

const inputSchema = z.object({
  org_slug: orgSlugSchema,
  include_zero_calls: z.boolean().default(false),
  limit: z.number().int().min(1).max(1000).default(50),
  offset: z.number().int().min(0).default(0),
});

const countInputSchema = z.object({
  org_slug: orgSlugSchema,
  include_zero_calls: z.boolean().default(false),
});

export interface LeadWithCallActivity extends Lead {
  inbound_calls: number;
  outbound_calls: number;
  total_calls: number;
  last_call_at: string | null;
  first_call_at: string | null;
  total_duration_seconds: number;
}

// PostgREST returns bigint columns as either number or string depending on
// driver/version. Coerce to number defensively.
function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export async function listLeadsWithCallActivity(
  input: unknown,
): Promise<ActionResult<{ items: LeadWithCallActivity[]; total: number }>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { org_slug, include_zero_calls, limit, offset } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated");

  // Resolve org id + verify ownership in one round trip. The RPC also
  // runs with security invoker, so RLS is the safety net — but the app
  // gate is here, ahead of RLS.
  const { data: org } = await supabase
    .from("organisations")
    .select("id, slug")
    .eq("slug", org_slug)
    .eq("owner_id", user.id)
    .maybeSingle<{ id: string; slug: string }>();
  if (!org) return fail("Forbidden");

  // Items + total in parallel — total stays accurate across pages.
  const [itemsRes, countRes] = await Promise.all([
    supabase.rpc("lead_call_activity", {
      p_org_id: org.id,
      p_org_slug: org_slug,
      p_include_zero_calls: include_zero_calls,
      p_limit: limit,
      p_offset: offset,
    }),
    supabase.rpc("lead_call_activity_count", {
      p_org_id: org.id,
      p_org_slug: org_slug,
      p_include_zero_calls: include_zero_calls,
    }),
  ]);

  if (itemsRes.error) return fail(itemsRes.error.message);
  if (countRes.error) return fail(countRes.error.message);

  const rows = (itemsRes.data ?? []) as Array<Lead & {
    inbound_calls: number | string;
    outbound_calls: number | string;
    total_calls: number | string;
    last_call_at: string | null;
    first_call_at: string | null;
    total_duration_seconds: number | string;
  }>;

  const items: LeadWithCallActivity[] = rows.map((r) => ({
    ...(r as Lead),
    inbound_calls: toNumber(r.inbound_calls),
    outbound_calls: toNumber(r.outbound_calls),
    total_calls: toNumber(r.total_calls),
    last_call_at: r.last_call_at,
    first_call_at: r.first_call_at,
    total_duration_seconds: toNumber(r.total_duration_seconds),
  }));

  return ok({ items, total: toNumber(countRes.data) });
}

export async function countLeadCallActivity(
  input: unknown,
): Promise<ActionResult<number>> {
  const parsed = countInputSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { org_slug, include_zero_calls } = parsed.data;

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
  });

  if (error) return fail(error.message);
  return ok(toNumber(data));
}
