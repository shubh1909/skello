import type { BolnaCsvRow } from "@/lib/validations/bolna-csv";

// The Bolna export CSV flattens
//   `extracted_data.<category>.<field>.<aspect>`
// into one column per (category, field, aspect) triple. Field keys can
// themselves contain underscores (e.g. `lead_score`, `call_back_time`,
// `interest_objective`, `interest_subjective`), so we resolve the aspect
// suffix by longest-match before splitting category/field.
//
// Category naming convention: single underscore-free segment (`finance`,
// `vehicle`, `extra_data`-style is reserved for `lead_data` only). The
// parser hard-codes `lead_data` as the lone two-segment exception because
// that's what the existing Bolna export emits. Any other multi-segment
// category would collide with a field whose name starts with the same
// segment — keep new category names single-word to avoid that.

const PREFIX = "extracted_data_";
const LEAD_DATA_CATEGORY = "lead_data";
const LEAD_DATA_CATEGORY_PREFIX = `${LEAD_DATA_CATEGORY}_`;

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

export interface ExtractedDataColumn {
  header: string;
  category: string;
  field: string;
  aspect: Aspect;
}

// Resolve the extracted_data columns once for the whole file rather than
// per-row. Returns the parsed (category, field, aspect) split alongside the
// original header so the row-to-payload step is a flat O(columns) loop.
//
// Parse order matters: pull the aspect suffix off first (longest-match),
// then disambiguate category vs field on the remaining stem.
export function indexExtractedDataColumns(
  headers: readonly string[],
): ExtractedDataColumn[] {
  const out: ExtractedDataColumn[] = [];
  for (const header of headers) {
    if (!header.startsWith(PREFIX)) continue;
    const tail = header.slice(PREFIX.length);

    let matchedAspect: Aspect | null = null;
    let stem = "";
    for (const aspect of ASPECT_SUFFIXES) {
      const suffix = `_${aspect}`;
      if (tail.endsWith(suffix) && tail.length > suffix.length) {
        matchedAspect = aspect;
        stem = tail.slice(0, -suffix.length);
        break;
      }
    }
    if (!matchedAspect) continue;

    // `lead_data` is the only multi-segment category we recognise; everything
    // else is a single segment terminated by the first underscore.
    if (stem.startsWith(LEAD_DATA_CATEGORY_PREFIX)) {
      out.push({
        header,
        category: LEAD_DATA_CATEGORY,
        field: stem.slice(LEAD_DATA_CATEGORY_PREFIX.length),
        aspect: matchedAspect,
      });
      continue;
    }
    const sepIdx = stem.indexOf("_");
    if (sepIdx <= 0 || sepIdx === stem.length - 1) continue;
    out.push({
      header,
      category: stem.slice(0, sepIdx),
      field: stem.slice(sepIdx + 1),
      aspect: matchedAspect,
    });
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
  index: readonly ExtractedDataColumn[],
): ParsedRow {
  // category -> field -> { aspect: value }
  const extractedData: Record<
    string,
    Record<string, Record<string, unknown>>
  > = {};
  for (const { header, category, field, aspect } of index) {
    const value = coerceCell(row[header]);
    if (value === null || value === undefined) continue;
    const cat = (extractedData[category] ??= {});
    (cat[field] ??= {})[aspect] = value;
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
      extracted_data: extractedData,
    },
    original: row,
    issues,
  };
}
