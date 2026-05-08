/** RFC 4180 escape: wrap in double quotes if the value contains "/,/CR/LF; double-up internal quotes. */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
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
