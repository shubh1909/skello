import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { leadActivityFilterSchema } from "@/lib/validations/lead-activity";
import { logSkeloError } from "@/lib/errors";
import { requireSession } from "@/lib/auth/session";
import { checkRateLimit, tooManyRequestsResponse } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Drives the "You'll download ~N rows" preview in LeadExportDialog. Calls
// the same `lead_call_activity_count` RPC the leads table uses, with the
// same filter set, search, and date range that the corresponding export
// route would apply — so the previewed number matches the file size below
// the cap, and exceeds it (with a warning surfaced by the dialog) above.
//
// Returns the cap alongside the count so the client can format messaging
// without hard-coding the value on both sides.
const EXPORT_CAP = 10_000;

const isoDatetimeSchema = z.string().datetime({ offset: true });
const filtersJsonSchema = z
  .string()
  .max(8_000)
  .transform((raw, ctx) => {
    try {
      const parsed = JSON.parse(raw);
      return z.array(leadActivityFilterSchema).max(20).parse(parsed);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          err instanceof Error
            ? `Invalid filters JSON: ${err.message}`
            : "Invalid filters JSON",
      });
      return z.NEVER;
    }
  });
const countInputSchema = z.object({
  from: isoDatetimeSchema.optional(),
  to: isoDatetimeSchema.optional(),
  filters: filtersJsonSchema.optional(),
  search: z.string().trim().max(200).optional(),
});

export async function GET(request: NextRequest) {
  const session = await requireSession();

  // 30 count probes per minute per user. Higher cap than the actual
  // export because the dialog fires this on every range change and
  // open/close cycle (debounced 300ms client-side).
  const rl = await checkRateLimit({
    key: `leads-export-count:user:${session.userId}`,
    windowSeconds: 60,
    max: 30,
  });
  if (!rl.allowed) {
    return tooManyRequestsResponse(rl.retryAfterSeconds);
  }

  const sp = request.nextUrl.searchParams;
  const parsed = countInputSchema.safeParse({
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    filters: sp.get("filters") ?? undefined,
    search: sp.get("search") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? "Invalid count query",
      },
      { status: 400 },
    );
  }
  const { from, to, filters, search } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lead_call_activity_count", {
    p_org_id: session.organisation.id,
    p_org_slug: session.organisation.slug,
    p_include_zero_calls: true,
    p_filters: filters ?? [],
    p_search: search ?? null,
    p_from: from ?? null,
    p_to: to ?? null,
  });
  if (error) {
    const message = logSkeloError("EXPORT", "Lead export count failed", {
      organisationId: session.organisation.id,
      cause: error,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // The RPC returns a bigint; postgrest-js surfaces it as `number` for
  // small values and `string` once it exceeds 2^53. Normalising to number
  // here is safe — an org with >9_quadrillion leads is not a concern.
  const count =
    typeof data === "number"
      ? data
      : typeof data === "string"
        ? Number.parseInt(data, 10)
        : 0;

  return NextResponse.json(
    { count, cap: EXPORT_CAP },
    { headers: { "Cache-Control": "no-store" } },
  );
}
