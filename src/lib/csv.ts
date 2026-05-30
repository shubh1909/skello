// Cells starting with these characters are interpreted as formulas by
// Excel, Google Sheets, LibreOffice Calc, and Numbers. Prefixing the cell
// with a single quote disarms the formula (the quote is consumed by the
// spreadsheet, the literal value is what the user sees) without breaking
// the data for non-spreadsheet consumers — they see a leading apostrophe,
// which is a tolerable tradeoff vs. a CSV-injection exfil.
//
// See OWASP "CSV Injection" / CWE-1236. Attackers reach the input via any
// channel that flows into an exported field: lead names from webhooks,
// transcripts from the voice agent, campaign error messages, custom
// fields from CSV imports, etc.
const FORMULA_START = /^[=+\-@\t\r]/;

/** RFC 4180 escape + CSV-formula-injection guard. */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
  if (FORMULA_START.test(s)) {
    // Force-quote and prepend a literal apostrophe so a spreadsheet
    // engine treats the cell as text. The apostrophe goes INSIDE the
    // quoted field so RFC 4180 readers still parse the cell cleanly.
    return `"'${s.replace(/"/g, '""')}"`;
  }
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export interface CsvColumn<Row> {
  header: string;
  value: (row: Row) => unknown;
}

export function toCsv<Row>(rows: Row[], columns: CsvColumn<Row>[]): string {
  const head = columns.map((c) => csvEscape(c.header)).join(",");
  const body = rows.map((row) =>
    columns.map((c) => csvEscape(c.value(row))).join(","),
  );
  return [head, ...body].join("\r\n");
}

/** Add a UTF-8 BOM so Excel opens the file as UTF-8. */
export function withBom(csv: string): string {
  return `﻿${csv}`;
}
