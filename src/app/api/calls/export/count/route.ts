import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { logSkeloError } from "@/lib/errors";
import { requireSession } from "@/lib/auth/session";
import { applyCallFilters } from "@/lib/queries/call-filters";
import { createClient } from "@/lib/supabase/server";
import {
  callDirectionSchema,
  callStatusSchema,
} from "@/lib/validations/call";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mirrors the conversations export filter set so the dialog can preview
// "You'll download ~N rows" before the user commits. Uses Supabase's
// `count: "exact", head: true` to avoid pulling row payloads — Postgres
// runs the same WHERE clause but only returns the count.
const EXPORT_CAP = 10_000;

const isoDatetimeSchema = z.string().datetime({ offset: true });
const countInputSchema = z.object({
  from: isoDatetimeSchema.optional(),
  to: isoDatetimeSchema.optional(),
  direction: callDirectionSchema.optional(),
  status: callStatusSchema.optional(),
  agent_id: z.string().trim().min(1).max(200).optional(),
  q: z.string().trim().max(200).optional(),
  lead_id: z.string().uuid().optional(),
});

export async function GET(request: NextRequest) {
  const session = await requireSession();
  const sp = request.nextUrl.searchParams;
  const parsed = countInputSchema.safeParse({
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    direction: sp.get("direction") ?? undefined,
    status: sp.get("status") ?? undefined,
    agent_id: sp.get("agent_id") ?? undefined,
    q: sp.get("q") ?? undefined,
    lead_id: sp.get("lead_id") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid count query" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  let query = supabase
    .from("calls")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", session.organisation.id);

  query = applyCallFilters(query, parsed.data);

  const { count, error } = await query;
  if (error) {
    const message = logSkeloError("EXPORT", "Call export count failed", {
      organisationId: session.organisation.id,
      cause: error,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json(
    { count: count ?? 0, cap: EXPORT_CAP },
    { headers: { "Cache-Control": "no-store" } },
  );
}
