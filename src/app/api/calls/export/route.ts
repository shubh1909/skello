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

// recording_url / transcript_url / transcript are intentionally omitted —
// per product call, downloadable CSVs must not leak signed audio links, and
// the full transcript bloats the file enough to choke Excel on large pulls.
const CALL_COLUMNS =
  "id, bolna_call_id, direction, status, agent_id, to_phone, from_phone, " +
  "started_at, answered_at, ended_at, duration_seconds, language, summary, " +
  "name_extracted, interest, lead_intent_extracted, customer_status, " +
  "actionable, visit_scheduled_at, connect_on_whatsapp, transcript_status, " +
  "lead_data, custom_data, error_code, error_message, " +
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
  lead_data: Record<string, unknown> | null;
  custom_data: Record<string, Record<string, unknown>> | null;
  error_code: string | null;
  error_message: string | null;
  lead: { name: string | null; phone: string | null } | null;
}

interface ExportRow extends CallRow {
  agent_label: string | null;
  counterparty_phone: string | null;
  captured_fields: string | null;
}

// Keys already surfaced as their own CSV columns — skip when flattening
// lead_data into "Captured Fields" so the same value doesn't appear twice.
// Mirrors CALL_LEAD_DATA_SURFACED in the side-sheet UI.
const CALL_LEAD_DATA_SURFACED = new Set([
  "name",
  "interest",
  "lead_intent",
  "actionable",
  "customer_status",
  "connect_on_whatsapp",
  "date_and_time_of_visit",
  "business_slug",
]);

const UNGROUPED_CATEGORIES = new Set(["", "__general__", "general"]);

function humaniseFieldKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

function stringifyValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return null;
    const lower = t.toLowerCase();
    if (lower === "yes" || lower === "true") return "Yes";
    if (lower === "no" || lower === "false") return "No";
    return t;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((v) => stringifyValue(v))
      .filter((v): v is string => v !== null);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

// Flatten lead_data extras + custom_data into a single human-readable
// pipe-separated string for the "Captured Fields" CSV column. Stable schema:
// every row gets the same column regardless of which fields the org captures.
function buildCapturedFields(
  leadData: Record<string, unknown> | null,
  customData: Record<string, Record<string, unknown>> | null,
): string | null {
  const parts: string[] = [];

  if (leadData) {
    for (const [k, v] of Object.entries(leadData)) {
      if (CALL_LEAD_DATA_SURFACED.has(k)) continue;
      const rendered = stringifyValue(v);
      if (rendered === null) continue;
      parts.push(`${humaniseFieldKey(k)}: ${rendered}`);
    }
  }

  if (customData) {
    for (const [cat, bag] of Object.entries(customData)) {
      if (!bag || typeof bag !== "object") continue;
      const isUngrouped = UNGROUPED_CATEGORIES.has(cat);
      const catLabel = isUngrouped ? null : humaniseFieldKey(cat);
      for (const [k, v] of Object.entries(bag)) {
        const rendered = stringifyValue(v);
        if (rendered === null) continue;
        const keyLabel = humaniseFieldKey(k);
        parts.push(
          catLabel ? `${catLabel} > ${keyLabel}: ${rendered}` : `${keyLabel}: ${rendered}`,
        );
      }
    }
  }

  return parts.length > 0 ? parts.join(" | ") : null;
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
  { header: "Summary", value: (c) => c.summary },
  { header: "Intent", value: (c) => c.lead_intent_extracted },
  { header: "Interest", value: (c) => c.interest },
  { header: "Customer Type", value: (c) => c.customer_status },
  { header: "Actionable", value: (c) => c.actionable },
  { header: "Visit Scheduled", value: (c) => c.visit_scheduled_at },
  { header: "Wants WA", value: (c) => c.connect_on_whatsapp },
  { header: "Captured Fields", value: (c) => c.captured_fields },
  { header: "Error Code", value: (c) => c.error_code },
  { header: "Error Message", value: (c) => c.error_message },
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
    .from("calls")
    .select(CALL_COLUMNS)
    .eq("organisation_id", session.organisation.id)
    .order("started_at", { ascending: false })
    .limit(10_000);

  const { from, to } = rangeBounds(range, Date.now());
  if (from) query = query.gte("started_at", from);
  if (to) query = query.lt("started_at", to);

  const { data, error } = await query.returns<CallRow[]>();
  if (error) {
    const message = logSkeloError("EXPORT", "Call export query failed", {
      organisationId: session.organisation.id,
      cause: error,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const calls = data ?? [];

  // Resolve agent labels in one round trip. Falls back to the raw agent_id
  // when no voice_agents row exists (e.g. a legacy / unregistered agent).
  const agentIds = Array.from(new Set(calls.map((c) => c.agent_id).filter(Boolean)));
  const labelById = await fetchAgentLabels(session.organisation.id, agentIds);

  const rows: ExportRow[] = calls.map((c) => ({
    ...c,
    agent_label: labelById.get(c.agent_id) ?? null,
    counterparty_phone: c.direction === "inbound" ? c.from_phone : c.to_phone,
    captured_fields: buildCapturedFields(c.lead_data, c.custom_data),
  }));

  const body = withBom(toCsv(rows, CSV_COLUMNS));
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `skelo-calls-${range}-${stamp}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
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
