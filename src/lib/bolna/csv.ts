import type { BolnaCsvRow } from "@/lib/validations/bolna-csv";

// The Bolna export CSV flattens `extracted_data.lead_data.<field>.<aspect>`
// into one column per (field, aspect) pair. Field keys can themselves
// contain underscores (e.g. `lead_score`, `call_back_time`,
// `interest_objective`, `interest_subjective`), so we resolve the aspect
// suffix by longest-match before splitting.

const LEAD_DATA_PREFIX = "extracted_data_lead_data_";

const ASPECT_SUFFIXES = [
  "reasoning_objective",
  "reasoning_subjective",
  "confidence_label",
  "confidence",
  "objective",
  "subjective",
  "validation",
] as const;

type Aspect = (typeof ASPECT_SUFFIXES)[number];

// Headers we require to recognise the file as a Bolna export. Detection is
// strict so a user can't accidentally feed in a generic call CSV and have
// the importer guess at the columns.
export const REQUIRED_BOLNA_HEADERS = [
  "id",
  "agent_id",
  "user_number",
  "agent_number",
  "status",
  "duration",
  "created_at",
  "transcript",
] as const;

export interface DetectResult {
  ok: boolean;
  missing: string[];
}

export function detectBolnaCsv(headers: readonly string[]): DetectResult {
  const set = new Set(headers.map((h) => h.trim()));
  const missing = REQUIRED_BOLNA_HEADERS.filter((h) => !set.has(h));
  return { ok: missing.length === 0, missing };
}

export interface LeadDataColumn {
  header: string;
  field: string;
  aspect: Aspect;
}

// Resolve the lead_data columns once for the whole file rather than per-row.
// Returns the parsed (field, aspect) split alongside the original header so
// the row-to-payload step is a flat O(columns) loop.
export function indexLeadDataColumns(
  headers: readonly string[],
): LeadDataColumn[] {
  const out: LeadDataColumn[] = [];
  for (const header of headers) {
    if (!header.startsWith(LEAD_DATA_PREFIX)) continue;
    const tail = header.slice(LEAD_DATA_PREFIX.length);
    for (const aspect of ASPECT_SUFFIXES) {
      const suffix = `_${aspect}`;
      if (tail.endsWith(suffix) && tail.length > suffix.length) {
        out.push({ header, field: tail.slice(0, -suffix.length), aspect });
        break;
      }
    }
  }
  return out;
}

function coerceCell(raw: string | undefined | null): unknown {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
  }
  return trimmed;
}

function nonEmpty(raw: string | undefined | null): string | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

function toNumber(raw: string | undefined | null): number | null {
  const trimmed = nonEmpty(raw);
  if (trimmed === null) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

// Pre-flight validation issues we surface in the preview table before the
// user clicks Import. These are all client-side checks; the server-side
// validation will also reject any of these.
export interface RowIssue {
  kind: "missing_id" | "missing_agent_id" | "missing_phone";
  message: string;
}

export interface ParsedRow {
  payload: BolnaCsvRow;
  // Preserve the original raw cells so we can rebuild an "errors.csv" later
  // without having to re-read the file.
  original: Record<string, string>;
  issues: RowIssue[];
}

export function rowToImportPayload(
  row: Record<string, string>,
  leadDataIndex: readonly LeadDataColumn[],
): ParsedRow {
  const leadData: Record<string, Record<string, unknown>> = {};
  for (const { header, field, aspect } of leadDataIndex) {
    const value = coerceCell(row[header]);
    if (value === null || value === undefined) continue;
    (leadData[field] ??= {})[aspect] = value;
  }

  const id = nonEmpty(row.id) ?? "";
  const agentId = nonEmpty(row.agent_id) ?? "";
  const userNumber = nonEmpty(row.user_number);

  const issues: RowIssue[] = [];
  if (!id) issues.push({ kind: "missing_id", message: "Missing call id" });
  if (!agentId)
    issues.push({ kind: "missing_agent_id", message: "Missing agent_id" });
  if (!userNumber)
    issues.push({
      kind: "missing_phone",
      message: "Missing user_number — call row will be created without a lead",
    });

  return {
    payload: {
      id,
      agent_id: agentId,
      user_number: userNumber,
      agent_number: nonEmpty(row.agent_number),
      status: nonEmpty(row.status),
      duration: toNumber(row.duration),
      recording_url: nonEmpty(row.recording_url),
      // Transcripts may contain newlines & non-ASCII (Devanagari, etc.);
      // preserve them verbatim. We only trim leading/trailing whitespace.
      transcript: row.transcript ? row.transcript.trim() || null : null,
      created_at: nonEmpty(row.created_at),
      scheduled_at: nonEmpty(row.scheduled_at),
      total_cost: toNumber(row.total_cost),
      hangup_by: nonEmpty(row.hangup_by),
      hangup_reason: nonEmpty(row.hangup_reason),
      lead_data: leadData,
    },
    original: row,
    issues,
  };
}
