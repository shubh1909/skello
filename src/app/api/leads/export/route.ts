import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { type CsvColumn, toCsv, withBom } from "@/lib/csv";
import { createClient } from "@/lib/supabase/server";
import type { Lead } from "@/types/lead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rangeSchema = z.enum([
  "today",
  "yesterday",
  "last_week",
  "last_month",
  "all",
]);

type Range = z.infer<typeof rangeSchema>;

const LEAD_COLUMNS =
  "id, created_at, updated_at, external_id, name, interest, summary, lead_intent, visit_date_time, customer_status, phone, wants_to_connect_on_watsapp, pending_action, source, status, notes, city, pincode";

// Rolling-window date boundaries. Returning `null` means "no date filter".
function rangeBounds(
  range: Range,
  now: number,
): { from: string | null; to: string | null } {
  const day = 24 * 60 * 60 * 1000;
  switch (range) {
    case "today":
      return { from: new Date(now - day).toISOString(), to: null };
    case "yesterday":
      return {
        from: new Date(now - 2 * day).toISOString(),
        to: new Date(now - day).toISOString(),
      };
    case "last_week":
      return { from: new Date(now - 7 * day).toISOString(), to: null };
    case "last_month":
      return { from: new Date(now - 30 * day).toISOString(), to: null };
    case "all":
      return { from: null, to: null };
  }
}

const CSV_COLUMNS: CsvColumn<Lead>[] = [
  { header: "ID", value: (l) => l.id },
  { header: "Created At", value: (l) => l.created_at },
  { header: "Name", value: (l) => l.name },
  { header: "Phone", value: (l) => l.phone },
  { header: "Interest", value: (l) => l.interest },
  { header: "Summary", value: (l) => l.summary },
  { header: "Intent", value: (l) => l.lead_intent },
  { header: "Status", value: (l) => l.status },
  { header: "Source", value: (l) => l.source },
  { header: "Customer Type", value: (l) => l.customer_status },
  { header: "City", value: (l) => l.city },
  { header: "Pincode", value: (l) => l.pincode },
  { header: "Visit", value: (l) => l.visit_date_time },
  { header: "Pending Action", value: (l) => l.pending_action },
  { header: "Wants WA", value: (l) => l.wants_to_connect_on_watsapp },
  { header: "Notes", value: (l) => l.notes },
  { header: "Capture ID", value: (l) => l.external_id },
];

export async function GET(request: NextRequest) {
  const session = await requireSession();

  const rawRange = request.nextUrl.searchParams.get("range") ?? "all";
  const parsedRange = rangeSchema.safeParse(rawRange);
  if (!parsedRange.success) {
    return NextResponse.json(
      { error: "Invalid range. Use today, yesterday, last_week, last_month, or all." },
      { status: 400 },
    );
  }
  const range = parsedRange.data;

  const supabase = await createClient();
  let query = supabase
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("org_slug", session.organisation.slug)
    .order("created_at", { ascending: false })
    .limit(10_000);

  const { from, to } = rangeBounds(range, Date.now());
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lt("created_at", to);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const leads = (data ?? []) as unknown as Lead[];
  const body = withBom(toCsv(leads, CSV_COLUMNS));

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `skelo-leads-${range}-${stamp}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
