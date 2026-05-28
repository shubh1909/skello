import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { leadActivityFilterSchema } from "@/lib/validations/lead-activity";
import {
  type CustomFieldsCarrier,
  type DiscoveredCustomField,
  discoverCustomFields,
  pickCustomFieldValue,
  stringifyCustomValue,
} from "@/lib/csv-custom-fields";
import { logSkeloError } from "@/lib/errors";
import { requireSession } from "@/lib/auth/session";
import { type CsvColumn, toCsv, withBom } from "@/lib/csv";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-export row cap. We fetch CAP+1 from the RPC and use the +1 sentinel
// to flag truncation — same trick as the calls export route — so the
// dialog can warn that the filter still has more matches than this file
// contains.
const EXPORT_CAP = 10_000;

// Backend contract: the frontend resolves a preset (or custom date inputs)
// into concrete from/to ISO timestamps and posts them as query params.
// `range` is carried through for the filename only; the query uses
// from/to. `null` on either bound means "open" on that side.
//
// `filters` and `search` mirror the leads-table state and flow into the
// `lead_call_activity` RPC via p_filters / p_search. The route does NOT
// validate the filter set's referential integrity (key existence in the
// catalog) — the RPC silently drops filters whose `source` it doesn't
// recognise, and any wrong-type comparison turns into "no rows match"
// (safer than returning everything by accident).
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
const exportInputSchema = z.object({
  from: isoDatetimeSchema.optional(),
  to: isoDatetimeSchema.optional(),
  range: z.string().trim().max(40).optional(),
  filters: filtersJsonSchema.optional(),
  search: z.string().trim().max(200).optional(),
});

// The RPC `lead_call_activity` returns LeadRow's fields + the per-row call
// snapshot (latest_call_interest/summary/recording_url) + the aggregate
// columns. The export only consumes the LeadRow fields here; downstream
// code doesn't read the aggregates so they're typed as unknown extras.
interface LeadRow extends CustomFieldsCarrier {
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

// lead_data keys that already get a dedicated static column above
// (Interest, Customer Type, Visit Scheduled, Wants WA). Skipping them
// in discovery prevents the same value from being duplicated as a
// dynamic column.
const SURFACED_LEAD_DATA_KEYS = new Set([
  "interest",
  "customer_status",
  "connect_on_whatsapp",
  "date_and_time_of_visit",
]);

const STATIC_CSV_COLUMNS: CsvColumn<ExportRow>[] = [
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

// Catalog-derived columns slot in just before "Notes" so the trailing
// free-text column keeps its position at the right edge of the sheet
// (admins are used to scrolling all the way over for it).
function buildCsvColumns(
  fields: DiscoveredCustomField[],
): CsvColumn<ExportRow>[] {
  const dynamicColumns: CsvColumn<ExportRow>[] = fields.map((f) => ({
    header: f.header,
    value: (row) => stringifyCustomValue(pickCustomFieldValue(row, f)),
  }));
  const notesIdx = STATIC_CSV_COLUMNS.findIndex(
    (col) => col.header === "Notes",
  );
  if (notesIdx === -1) {
    return [...STATIC_CSV_COLUMNS, ...dynamicColumns];
  }
  return [
    ...STATIC_CSV_COLUMNS.slice(0, notesIdx),
    ...dynamicColumns,
    ...STATIC_CSV_COLUMNS.slice(notesIdx),
  ];
}

export async function GET(request: NextRequest) {
  const session = await requireSession();

  const sp = request.nextUrl.searchParams;
  const parsedInput = exportInputSchema.safeParse({
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    range: sp.get("range") ?? undefined,
    filters: sp.get("filters") ?? undefined,
    search: sp.get("search") ?? undefined,
  });
  if (!parsedInput.success) {
    return NextResponse.json(
      {
        error:
          parsedInput.error.issues[0]?.message ??
          "Invalid query. `from`/`to` must be ISO datetimes; `filters` must be JSON.",
      },
      { status: 400 },
    );
  }
  const { from, to, range, filters, search } = parsedInput.data;

  const supabase = await createClient();
  // Use the same RPC as the leads table so the export's WHERE clause stays
  // in lockstep with the in-app filter logic — same catalog awareness for
  // dynamic JSONB fields, same column allowlist, same date-range handling.
  // Sort by created_at desc to match the route's pre-RPC behaviour (newest
  // captured leads first), and pull include_zero_calls=true since exporters
  // generally want every lead in the window, not just contacted ones.
  const { data, error } = await supabase.rpc("lead_call_activity", {
    p_org_id: session.organisation.id,
    p_org_slug: session.organisation.slug,
    p_include_zero_calls: true,
    p_limit: EXPORT_CAP + 1,
    p_offset: 0,
    p_filters: filters ?? [],
    p_sort_by: {
      source: "column",
      key: "created_at",
      dir: "desc",
      type: "date",
    },
    p_search: search ?? null,
    p_from: from ?? null,
    p_to: to ?? null,
  });
  if (error) {
    const message = logSkeloError("EXPORT", "Lead export query failed", {
      organisationId: session.organisation.id,
      cause: error,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // supabase-js generates the RPC return as the row union rather than the
  // set type, so we widen-then-narrow rather than chaining .returns<T[]>().
  const raw = (data ?? []) as LeadRow[];
  const truncated = raw.length > EXPORT_CAP;
  const leads = truncated ? raw.slice(0, EXPORT_CAP) : raw;

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

  const discoveredFields = discoverCustomFields(leads, SURFACED_LEAD_DATA_KEYS);
  const csvColumns = buildCsvColumns(discoveredFields);
  const body = withBom(toCsv(rows, csvColumns));
  const stamp = new Date().toISOString().slice(0, 10);
  const rangeLabel = (range ?? "custom").replace(/[^a-z0-9_-]+/gi, "_");
  const filename = `skelo-leads-${rangeLabel}-${stamp}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      // Forensic + UX headers: the dialog reads these to surface a toast
      // confirming row count and (when relevant) the cap being hit.
      "X-Export-Cap": String(EXPORT_CAP),
      "X-Export-Rows": String(leads.length),
      "X-Export-Truncated": truncated ? "true" : "false",
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
