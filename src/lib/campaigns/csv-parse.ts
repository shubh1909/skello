"use client";

import Papa from "papaparse";

import { normalisePhoneForWa } from "@/lib/format";

export interface ParsedContact {
  raw_phone: string;
  phone: string;
  name: string | null;
  metadata: Record<string, unknown>;
}

export interface ParsedCsv {
  contacts: ParsedContact[];
  /** Header in the source file used as the phone column. */
  phone_column: string;
  total_rows: number;
  valid_rows: number;
  duplicate_rows: number;
  /** First parser-level error message, if any. */
  error: string | null;
}

const PHONE_HEADER_HINTS = ["phone", "mobile", "number", "msisdn", "contact"];
const NAME_HEADER_HINTS = ["name", "full_name", "fullname", "contact_name"];

function pickColumn(headers: string[], hints: string[]): string | null {
  const lower = headers.map((h) => h.toLowerCase().trim());
  // Exact-ish match wins.
  for (const h of hints) {
    const i = lower.indexOf(h);
    if (i !== -1) return headers[i];
  }
  // Fall back to "contains".
  for (let i = 0; i < lower.length; i++) {
    if (hints.some((h) => lower[i].includes(h))) return headers[i];
  }
  return null;
}

export function parseCampaignCsv(file: File): Promise<ParsedCsv> {
  return new Promise((resolve) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (result) => {
        const headers = (result.meta.fields ?? []).filter(Boolean);
        const phoneCol = pickColumn(headers, PHONE_HEADER_HINTS);
        const nameCol = pickColumn(headers, NAME_HEADER_HINTS);

        if (!phoneCol) {
          resolve({
            contacts: [],
            phone_column: "",
            total_rows: result.data.length,
            valid_rows: 0,
            duplicate_rows: 0,
            error:
              "No phone column detected. Add a column named phone, mobile, or number.",
          });
          return;
        }

        const seen = new Set<string>();
        const contacts: ParsedContact[] = [];
        let duplicates = 0;

        for (const row of result.data) {
          const raw = String(row[phoneCol] ?? "").trim();
          if (!raw) continue;
          const normalized = normalisePhoneForWa(raw);
          if (normalized.length < 7 || normalized.length > 15) continue;
          if (seen.has(normalized)) {
            duplicates++;
            continue;
          }
          seen.add(normalized);

          const metadata: Record<string, unknown> = {};
          for (const h of headers) {
            if (h === phoneCol || h === nameCol) continue;
            const v = row[h];
            if (v !== undefined && v !== null && String(v).trim() !== "") {
              metadata[h] = v;
            }
          }

          contacts.push({
            raw_phone: raw,
            phone: normalized,
            name: nameCol ? (String(row[nameCol] ?? "").trim() || null) : null,
            metadata,
          });
        }

        resolve({
          contacts,
          phone_column: phoneCol,
          total_rows: result.data.length,
          valid_rows: contacts.length,
          duplicate_rows: duplicates,
          error: result.errors[0]?.message ?? null,
        });
      },
      error: (err) => {
        resolve({
          contacts: [],
          phone_column: "",
          total_rows: 0,
          valid_rows: 0,
          duplicate_rows: 0,
          error: err.message,
        });
      },
    });
  });
}
