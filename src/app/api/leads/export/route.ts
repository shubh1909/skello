import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { logSkeloError } from "@/lib/errors";
import { requireSession } from "@/lib/auth/session";
import { type CsvColumn, toCsv, withBom } from "@/lib/csv";
import { createClient } from "@/lib/supabase/server";

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

// Post-remodel: select what actually exists on `leads`, then join the most
// recent call's per-conversation snapshot (interest / summary / actionable /
// recording) for export rows that need it.
const LEAD_COLUMNS =
  "id, created_at, updated_at, name, phone, current_intent, source, status, " +
  "pending_action, notes, city, pincode, lead_data";

interface LeadRow {
  id: string;
  created_at: string;
  updated_at: string;
  name: string | null;
  phone: string | null;
  current_intent: string | null;
  source: string | null;
  status: string;
  pending_action: boolean;
  notes: string | null;
  city: string | null;
  pincode: string | null;
  lead_data: Record<string, unknown> | null;
}

// Per-call snapshot fields surfaced into the CSV. recording_url was
// intentionally dropped — exporters don't need playback URLs, and surfacing
// them invites leaking signed audio links to anyone who downloads the CSV.
interface CallSnapshot {
  interest: string | null;
  summary: string | null;
  actionable: string | null;
  customer_status: string | null;
  visit_scheduled_at: string | null;
}

interface ExportRow extends LeadRow {
  interest: string | null;
  summary: string | null;
  actionable: string | null;
  customer_status: string | null;
  visit_scheduled_at: string | null;
  wants_to_connect_on_watsapp: boolean | null;
}

function pickJsonString(blob: Record<string, unknown> | null, key: string): string | null {
  if (!blob) return null;
  const v = blob[key];
  if (typeof v === "string" && v.trim().length > 0) return v;
  return null;
}

function pickJsonBool(blob: Record<string, unknown> | null, key: string): boolean | null {
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

function pickJsonDate(blob: Record<string, unknown> | null, key: string): string | null {
  const v = pickJsonString(blob, key);
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

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

const CSV_COLUMNS: CsvColumn<ExportRow>[] = [
  { header: "ID", value: (l) => l.id },
  { header: "Created At", value: (l) => l.created_at },
  { header: "Name", value: (l) => l.name },
  { header: "Phone", value: (l) => l.phone },
  { header: "Interest", value: (l) => l.interest },
  { header: "Latest Call Summary", value: (l) => l.summary },
  { header: "Intent", value: (l) => l.current_intent },
  { header: "Status", value: (l) => l.status },
  { header: "Source", value: (l) => l.source },
  { header: "Customer Type", value: (l) => l.customer_status },
  { header: "City", value: (l) => l.city },
  { header: "Pincode", value: (l) => l.pincode },
  { header: "Visit Scheduled", value: (l) => l.visit_scheduled_at },
  { header: "Pending Action", value: (l) => l.pending_action },
  { header: "Wants WA", value: (l) => l.wants_to_connect_on_watsapp },
  { header: "Notes", value: (l) => l.notes },
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
    .eq("organisation_id", session.organisation.id)
    .order("created_at", { ascending: false })
    .limit(10_000);

  const { from, to } = rangeBounds(range, Date.now());
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lt("created_at", to);

  const { data, error } = await query.returns<LeadRow[]>();
  if (error) {
    const message = logSkeloError("EXPORT", "Lead export query failed", {
      organisationId: session.organisation.id,
      cause: error,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const leads = data ?? [];

  // Batch-fetch the most recent call per lead for the snapshot fields.
  // Single round trip; DISTINCT ON pinned via in-memory pick to avoid an
  // RPC. Acceptable up to ~10k rows.
  const snapshots = await fetchLatestCallSnapshots(
    session.organisation.id,
    leads.map((l) => l.id),
  );

  const rows: ExportRow[] = leads.map((l) => {
    const snap = snapshots.get(l.id);
    return {
      ...l,
      interest: snap?.interest ?? pickJsonString(l.lead_data, "interest"),
      summary: snap?.summary ?? null,
      actionable: snap?.actionable ?? null,
      customer_status:
        snap?.customer_status ?? pickJsonString(l.lead_data, "customer_status"),
      visit_scheduled_at:
        snap?.visit_scheduled_at ??
        pickJsonDate(l.lead_data, "date_and_time_of_visit"),
      wants_to_connect_on_watsapp: pickJsonBool(l.lead_data, "connect_on_whatsapp"),
    };
  });

  const body = withBom(toCsv(rows, CSV_COLUMNS));
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

async function fetchLatestCallSnapshots(
  organisationId: string,
  leadIds: string[],
): Promise<Map<string, CallSnapshot>> {
  const out = new Map<string, CallSnapshot>();
  if (leadIds.length === 0) return out;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calls")
    .select(
      "lead_id, interest, summary, actionable, customer_status, visit_scheduled_at, started_at",
    )
    .eq("organisation_id", organisationId)
    .in("lead_id", leadIds)
    .order("started_at", { ascending: false });
  if (error) {
    logSkeloError("EXPORT", "Latest-call snapshot fetch failed (CSV will omit snapshot columns)", {
      organisationId,
      cause: error,
    });
    return out;
  }
  for (const row of (data ?? []) as Array<{
    lead_id: string;
    interest: string | null;
    summary: string | null;
    actionable: string | null;
    customer_status: string | null;
    visit_scheduled_at: string | null;
  }>) {
    if (!out.has(row.lead_id)) {
      out.set(row.lead_id, {
        interest: row.interest,
        summary: row.summary,
        actionable: row.actionable,
        customer_status: row.customer_status,
        visit_scheduled_at: row.visit_scheduled_at,
      });
    }
  }
  return out;
}
