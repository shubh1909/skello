import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  type DiscoveredCustomField,
  discoverCustomFields,
  pickCustomFieldValue,
  stringifyCustomValue,
} from "@/lib/csv-custom-fields";
import { logSkeloError } from "@/lib/errors";
import { requireSession } from "@/lib/auth/session";
import { type CsvColumn, toCsv, withBom } from "@/lib/csv";
import { applyCallFilters } from "@/lib/queries/call-filters";
import { checkRateLimit, tooManyRequestsResponse } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import {
  callDirectionSchema,
  callStatusSchema,
} from "@/lib/validations/call";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-export row cap. A `limit(EXPORT_CAP + 1)` trick lets us detect
// truncation in the same query rather than running a second count
// roundtrip — anything past EXPORT_CAP is dropped before serialising and
// the X-Export-Truncated header tells the dialog to surface a warning.
const EXPORT_CAP = 10_000;

// Backend contract: the frontend resolves a preset (or custom date inputs)
// into concrete from/to ISO timestamps and posts them as query params.
// `range` is carried through for the filename only; the query uses from/to.
// `null` on either bound means "open" on that side. The filter block mirrors
// the conversations table — `direction`, `status`, `agent_id`, `q`, plus an
// optional `lead_id` for "export everything on this lead" flows. Each
// filter is independent; omit the param to skip it.
const isoDatetimeSchema = z.string().datetime({ offset: true });
const exportInputSchema = z.object({
  from: isoDatetimeSchema.optional(),
  to: isoDatetimeSchema.optional(),
  range: z.string().trim().max(40).optional(),
  direction: callDirectionSchema.optional(),
  status: callStatusSchema.optional(),
  agent_id: z.string().trim().min(1).max(200).optional(),
  q: z.string().trim().max(200).optional(),
  lead_id: z.string().uuid().optional(),
});

// recording_url / transcript_url are intentionally omitted — downloadable
// CSVs must not leak signed audio links. The `transcript` text body IS
// included now (admins asked for it); it can bloat the file on long calls,
// but that's a conscious tradeoff vs. the previous "ready/pending" string
// being the only transcript-related column.
const CALL_COLUMNS =
  "id, bolna_call_id, direction, status, agent_id, to_phone, from_phone, " +
  "started_at, answered_at, ended_at, duration_seconds, language, summary, " +
  "name_extracted, interest, lead_intent_extracted, customer_status, " +
  "actionable, visit_scheduled_at, connect_on_whatsapp, transcript_status, " +
  "transcript, lead_data, custom_data, error_code, error_message, " +
  "lead:leads(name, phone)";

interface CallRow {
  id: string;
  bolna_call_id: string | null;
  direction: "inbound" | "outbound";
  status: string;
  agent_id: string;
  to_phone: string | null;
  from_phone: string | null;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  language: string | null;
  summary: string | null;
  name_extracted: string | null;
  interest: string | null;
  lead_intent_extracted: "hot" | "warm" | "cold" | null;
  customer_status: string | null;
  actionable: string | null;
  visit_scheduled_at: string | null;
  connect_on_whatsapp: boolean | null;
  transcript_status: string | null;
  transcript: string | null;
  lead_data: Record<string, unknown> | null;
  custom_data: Record<string, Record<string, unknown>> | null;
  error_code: string | null;
  error_message: string | null;
  lead: { name: string | null; phone: string | null } | null;
}

interface ExportRow extends CallRow {
  agent_label: string | null;
  counterparty_phone: string | null;
}

// Keys already surfaced as their own CSV columns — skip when flattening
// lead_data so the same value doesn't appear twice. Mirrors the
// CALL_LEAD_DATA_SURFACED set in the call detail sheet.
const SURFACED_LEAD_DATA_KEYS = new Set([
  "name",
  "interest",
  "lead_intent",
  "actionable",
  "customer_status",
  "connect_on_whatsapp",
  "date_and_time_of_visit",
  "business_slug",
]);

const STATIC_CSV_COLUMNS: CsvColumn<ExportRow>[] = [
  { header: "Call ID", value: (c) => c.id },
  { header: "Provider Call ID", value: (c) => c.bolna_call_id },
  { header: "Started At", value: (c) => c.started_at },
  { header: "Answered At", value: (c) => c.answered_at },
  { header: "Ended At", value: (c) => c.ended_at },
  { header: "Duration (sec)", value: (c) => c.duration_seconds },
  { header: "Direction", value: (c) => c.direction },
  { header: "Outcome", value: (c) => c.status },
  { header: "Agent", value: (c) => c.agent_label ?? c.agent_id },
  { header: "Lead Name", value: (c) => c.lead?.name ?? null },
  { header: "Name (Captured)", value: (c) => c.name_extracted },
  { header: "Lead Phone", value: (c) => c.lead?.phone ?? c.counterparty_phone },
  { header: "From Phone", value: (c) => c.from_phone },
  { header: "To Phone", value: (c) => c.to_phone },
  { header: "Language", value: (c) => c.language },
  { header: "Transcript Status", value: (c) => c.transcript_status },
  { header: "Transcript", value: (c) => c.transcript },
  { header: "Summary", value: (c) => c.summary },
  { header: "Intent", value: (c) => c.lead_intent_extracted },
  { header: "Interest", value: (c) => c.interest },
  { header: "Customer Type", value: (c) => c.customer_status },
  { header: "Actionable", value: (c) => c.actionable },
  { header: "Visit Scheduled", value: (c) => c.visit_scheduled_at },
  { header: "Wants WA", value: (c) => c.connect_on_whatsapp },
  { header: "Error Code", value: (c) => c.error_code },
  { header: "Error Message", value: (c) => c.error_message },
];

// Per-field columns are inserted after "Wants WA" (where the old
// single "Captured Fields" column used to live), so the error pair
// stays at the right edge of the sheet.
function buildCsvColumns(
  fields: DiscoveredCustomField[],
): CsvColumn<ExportRow>[] {
  const dynamicColumns: CsvColumn<ExportRow>[] = fields.map((f) => ({
    header: f.header,
    value: (row) => stringifyCustomValue(pickCustomFieldValue(row, f)),
  }));
  const errorIdx = STATIC_CSV_COLUMNS.findIndex(
    (col) => col.header === "Error Code",
  );
  if (errorIdx === -1) {
    return [...STATIC_CSV_COLUMNS, ...dynamicColumns];
  }
  return [
    ...STATIC_CSV_COLUMNS.slice(0, errorIdx),
    ...dynamicColumns,
    ...STATIC_CSV_COLUMNS.slice(errorIdx),
  ];
}

export async function GET(request: NextRequest) {
  const session = await requireSession();

  // 5 exports per minute per user. Same envelope as the leads export
  // — keeps the database from being saturated by a tab-spamming user
  // without blocking the dialog's count-then-export flow.
  const rl = await checkRateLimit({
    key: `calls-export:user:${session.userId}`,
    windowSeconds: 60,
    max: 5,
  });
  if (!rl.allowed) {
    return tooManyRequestsResponse(rl.retryAfterSeconds);
  }

  const sp = request.nextUrl.searchParams;
  const parsedInput = exportInputSchema.safeParse({
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    range: sp.get("range") ?? undefined,
    direction: sp.get("direction") ?? undefined,
    status: sp.get("status") ?? undefined,
    agent_id: sp.get("agent_id") ?? undefined,
    q: sp.get("q") ?? undefined,
    lead_id: sp.get("lead_id") ?? undefined,
  });
  if (!parsedInput.success) {
    return NextResponse.json(
      {
        error:
          "Invalid filter set. `from`/`to` must be ISO datetimes; `direction`, `status`, `agent_id`, `q`, `lead_id` are optional.",
      },
      { status: 400 },
    );
  }
  const { from, to, range, direction, status, agent_id, q, lead_id } =
    parsedInput.data;

  const supabase = await createClient();
  // EXPORT_CAP + 1 fetched intentionally — the +1 is a sentinel row used
  // only to set X-Export-Truncated. It's dropped before CSV serialisation
  // so the user never sees it.
  let query = supabase
    .from("calls")
    .select(CALL_COLUMNS)
    .eq("organisation_id", session.organisation.id)
    .order("started_at", { ascending: false })
    .limit(EXPORT_CAP + 1);

  // applyCallFilters is the single source of truth for conversations table
  // filters, also used by listConversations in actions/calls.ts. The date
  // range and lead_id flow through the same helper.
  query = applyCallFilters(query, {
    from,
    to,
    direction,
    status,
    agent_id,
    q,
    lead_id,
  });

  const { data, error } = await query.returns<CallRow[]>();
  if (error) {
    const message = logSkeloError("EXPORT", "Call export query failed", {
      organisationId: session.organisation.id,
      cause: error,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const raw = data ?? [];
  const truncated = raw.length > EXPORT_CAP;
  const calls = truncated ? raw.slice(0, EXPORT_CAP) : raw;

  // Resolve agent labels in one round trip. Falls back to the raw agent_id
  // when no voice_agents row exists (e.g. a legacy / unregistered agent).
  const agentIds = Array.from(new Set(calls.map((c) => c.agent_id).filter(Boolean)));
  const labelById = await fetchAgentLabels(session.organisation.id, agentIds);

  const rows: ExportRow[] = calls.map((c) => ({
    ...c,
    agent_label: labelById.get(c.agent_id) ?? null,
    counterparty_phone: c.direction === "inbound" ? c.from_phone : c.to_phone,
  }));

  const discoveredFields = discoverCustomFields(calls, SURFACED_LEAD_DATA_KEYS);
  const csvColumns = buildCsvColumns(discoveredFields);
  const body = withBom(toCsv(rows, csvColumns));
  const stamp = new Date().toISOString().slice(0, 10);
  const rangeLabel = (range ?? "custom").replace(/[^a-z0-9_-]+/gi, "_");
  const filename = `skelo-calls-${rangeLabel}-${stamp}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      // Forensic + UX headers: the dialog reads these to surface a toast
      // confirming row count and (when relevant) the cap being hit. They
      // are also useful for anyone inspecting the response in DevTools.
      "X-Export-Cap": String(EXPORT_CAP),
      "X-Export-Rows": String(calls.length),
      "X-Export-Truncated": truncated ? "true" : "false",
    },
  });
}

async function fetchAgentLabels(
  organisationId: string,
  agentIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (agentIds.length === 0) return out;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("voice_agents")
    .select("agent_id, label")
    .eq("organisation_id", organisationId)
    .in("agent_id", agentIds)
    .returns<{ agent_id: string; label: string | null }[]>();
  if (error) {
    logSkeloError("EXPORT", "Voice-agent label fetch failed (CSV will fall back to agent_id)", {
      organisationId,
      cause: error,
    });
    return out;
  }
  for (const row of data ?? []) {
    const label = row.label?.trim();
    if (label) out.set(row.agent_id, label);
  }
  return out;
}
