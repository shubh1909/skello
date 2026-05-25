"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  DownloadIcon,
  FileSpreadsheetIcon,
  Loader2Icon,
  UploadCloudIcon,
  XCircleIcon,
} from "lucide-react";
import Papa from "papaparse";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type { ImportRowResult } from "@/lib/bolna/calls-import";
import {
  detectBolnaCsv,
  indexExtractedDataColumns,
  type ParsedRow,
  REQUIRED_BOLNA_HEADERS,
  rowToImportPayload,
} from "@/lib/bolna/csv";
import { IMPORT_CHUNK_SIZE } from "@/lib/validations/bolna-csv";

type Stage = "idle" | "parsing" | "preview" | "importing" | "done";

interface RunningTotals {
  imported: number;
  updated: number;
  errored: number;
}

// Wrap the server-returned discriminated union with a sibling object holding
// the original CSV row, so we can rebuild errors.csv without re-reading the
// file. Using a type alias (not `extends`) because TS doesn't let interfaces
// extend discriminated unions.
type CompletedRowResult = ImportRowResult & {
  original: Record<string, string>;
};

export function CallsCsvImporter() {
  const router = useRouter();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const [stage, setStage] = React.useState<Stage>("idle");
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [parsedRows, setParsedRows] = React.useState<ParsedRow[]>([]);
  const [parseError, setParseError] = React.useState<string | null>(null);

  // Importing-state bookkeeping. Refs so the running totals don't lag behind
  // the rapidly-firing chunk completions.
  const [progress, setProgress] = React.useState({ done: 0, total: 0 });
  const [totals, setTotals] = React.useState<RunningTotals>({
    imported: 0,
    updated: 0,
    errored: 0,
  });
  const [errorRows, setErrorRows] = React.useState<CompletedRowResult[]>([]);

  const totalRows = parsedRows.length;
  const totalIssues = parsedRows.reduce((acc, r) => acc + r.issues.length, 0);
  const rowsWithoutId = parsedRows.filter((r) =>
    r.issues.some((i) => i.kind === "missing_id"),
  ).length;
  const rowsWithoutAgent = parsedRows.filter((r) =>
    r.issues.some((i) => i.kind === "missing_agent_id"),
  ).length;
  const rowsWithoutPhone = parsedRows.filter((r) =>
    r.issues.some((i) => i.kind === "missing_phone"),
  ).length;

  function resetAll() {
    setStage("idle");
    setFileName(null);
    setParsedRows([]);
    setParseError(null);
    setProgress({ done: 0, total: 0 });
    setTotals({ imported: 0, updated: 0, errored: 0 });
    setErrorRows([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFile(file: File) {
    setFileName(file.name);
    setStage("parsing");
    setParseError(null);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      // Keep transcript newlines etc intact; PapaParse handles UTF-8 by default.
      complete: (result) => {
        const headers = (result.meta.fields ?? []).filter(Boolean);
        const detection = detectBolnaCsv(headers);
        if (!detection.ok) {
          setParseError(
            `This doesn't look like a Bolna export. Missing columns: ${detection.missing.join(
              ", ",
            )}`,
          );
          setStage("idle");
          return;
        }

        const extractedDataIndex = indexExtractedDataColumns(headers);
        const rows: ParsedRow[] = result.data.map((row) =>
          rowToImportPayload(row, extractedDataIndex),
        );

        // Drop completely empty rows (no id AND no agent_id AND no phone)
        // — these are usually stray blank lines at the end of the export.
        const filtered = rows.filter(
          (r) =>
            r.payload.id ||
            r.payload.agent_id ||
            r.payload.user_number,
        );

        if (filtered.length === 0) {
          setParseError("No usable rows found in the file.");
          setStage("idle");
          return;
        }

        setParsedRows(filtered);
        setStage("preview");
      },
      error: (err) => {
        setParseError(err.message);
        setStage("idle");
      },
    });
  }

  async function runImport() {
    // Only ship rows that pass the hard pre-flight checks (id + agent_id).
    // Missing phone is a soft issue — we still bootstrap the call row.
    const importable = parsedRows.filter(
      (r) =>
        !r.issues.some(
          (i) => i.kind === "missing_id" || i.kind === "missing_agent_id",
        ),
    );

    if (importable.length === 0) {
      toast.error("No rows with both a call id and agent_id to import.");
      return;
    }

    // Carry the rows we excluded so they show up in the errors CSV too.
    const preflightFailed: CompletedRowResult[] = parsedRows
      .filter((r) =>
        r.issues.some(
          (i) => i.kind === "missing_id" || i.kind === "missing_agent_id",
        ),
      )
      .map((r) => ({
        id: r.payload.id || "(missing)",
        outcome: "error",
        error: r.issues.map((i) => i.message).join("; "),
        original: r.original,
      }));

    setStage("importing");
    setProgress({ done: 0, total: importable.length });
    setTotals({
      imported: 0,
      updated: 0,
      errored: preflightFailed.length,
    });
    setErrorRows(preflightFailed);

    const indexByCallId = new Map<string, ParsedRow>();
    for (const r of importable) indexByCallId.set(r.payload.id, r);

    let imported = 0;
    let updated = 0;
    let errored = preflightFailed.length;
    const errors: CompletedRowResult[] = [...preflightFailed];

    // Track how many rows we've fully accounted for, so the bar advances
    // even if the server's NDJSON stream emits results in flush bursts.
    let processed = 0;

    for (let i = 0; i < importable.length; i += IMPORT_CHUNK_SIZE) {
      const chunk = importable.slice(i, i + IMPORT_CHUNK_SIZE);

      let response: Response;
      try {
        response = await fetch("/api/imports/calls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: chunk.map((r) => r.payload) }),
        });
      } catch (networkErr) {
        // Network drop / offline / aborted — fail the whole chunk and move on.
        const message =
          networkErr instanceof Error
            ? networkErr.message
            : "Network error while importing";
        for (const r of chunk) {
          errors.push({
            id: r.payload.id,
            outcome: "error",
            error: message,
            original: r.original,
          });
          errored += 1;
        }
        processed += chunk.length;
        setProgress({ done: processed, total: importable.length });
        setTotals({ imported, updated, errored });
        setErrorRows([...errors]);
        continue;
      }

      if (!response.ok || !response.body) {
        // Pre-stream failure (401/400/500 with a JSON error body).
        let message = `Server responded ${response.status}`;
        try {
          const errJson = (await response.json()) as { error?: string };
          if (errJson.error) message = errJson.error;
        } catch {
          /* fall through with the status message */
        }
        for (const r of chunk) {
          errors.push({
            id: r.payload.id,
            outcome: "error",
            error: message,
            original: r.original,
          });
          errored += 1;
        }
        processed += chunk.length;
        setProgress({ done: processed, total: importable.length });
        setTotals({ imported, updated, errored });
        setErrorRows([...errors]);
        continue;
      }

      // NDJSON stream — one JSON object per row, terminated by "\n". Buffer
      // partial lines because TCP packet boundaries don't respect newlines.
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      const seenIds = new Set<string>();

      const handleLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let result: ImportRowResult;
        try {
          result = JSON.parse(trimmed) as ImportRowResult;
        } catch {
          return;
        }
        seenIds.add(result.id);
        const source = indexByCallId.get(result.id);
        if (result.outcome === "imported") imported += 1;
        else if (result.outcome === "updated") updated += 1;
        else {
          errored += 1;
          errors.push({
            ...result,
            original: source?.original ?? {},
          });
        }
        processed += 1;
        // Tick the bar per row. setState during a streaming fetch is
        // committed at normal priority (no concurrent transition is open
        // since we removed the server-side revalidatePath), so each tick
        // paints before the next read resolves.
        setProgress({ done: processed, total: importable.length });
        setTotals({ imported, updated, errored });
        setErrorRows([...errors]);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // Flush any trailing partial line (shouldn't normally happen since
          // the server always writes a "\n", but defend against it).
          if (buffer.length > 0) handleLine(buffer);
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let newlineIdx = buffer.indexOf("\n");
        while (newlineIdx !== -1) {
          const line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          handleLine(line);
          newlineIdx = buffer.indexOf("\n");
        }
      }

      // Defensive: if the stream closed mid-chunk and some rows never got
      // a result line, mark them errored so the totals reconcile.
      for (const r of chunk) {
        if (!seenIds.has(r.payload.id)) {
          errors.push({
            id: r.payload.id,
            outcome: "error",
            error: "Stream closed before this row reported a result",
            original: r.original,
          });
          errored += 1;
          processed += 1;
        }
      }
      setProgress({ done: processed, total: importable.length });
      setTotals({ imported, updated, errored });
      setErrorRows([...errors]);
    }

    setStage("done");
    toast.success(
      `Import complete: ${imported} new, ${updated} updated, ${errored} errored`,
    );
    // Let the rest of the app see the new rows.
    router.refresh();
  }

  function downloadErrorsCsv() {
    if (errorRows.length === 0) return;
    const headers = new Set<string>();
    for (const row of errorRows) for (const k of Object.keys(row.original)) headers.add(k);
    const headerList = [...headers, "error_reason"];
    const escape = (v: string) => {
      if (v.includes(",") || v.includes('"') || v.includes("\n")) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return v;
    };
    const lines = [headerList.map(escape).join(",")];
    for (const row of errorRows) {
      const reason = row.outcome === "error" ? row.error : "";
      const cells = headerList.map((h) =>
        h === "error_reason" ? escape(reason) : escape(row.original[h] ?? ""),
      );
      lines.push(cells.join(","));
    }
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `import-errors-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      {(stage === "idle" || stage === "parsing") && (
        <UploadCard
          parsing={stage === "parsing"}
          fileName={fileName}
          parseError={parseError}
          onPick={() => fileInputRef.current?.click()}
        />
      )}

      {stage === "preview" && (
        <PreviewCard
          fileName={fileName ?? ""}
          totalRows={totalRows}
          totalIssues={totalIssues}
          rowsWithoutId={rowsWithoutId}
          rowsWithoutAgent={rowsWithoutAgent}
          rowsWithoutPhone={rowsWithoutPhone}
          sample={parsedRows.slice(0, 10)}
          onCancel={resetAll}
          onImport={runImport}
        />
      )}

      {(stage === "importing" || stage === "done") && (
        <ProgressCard
          stage={stage}
          progress={progress}
          totals={totals}
          errorCount={errorRows.length}
          onDownloadErrors={downloadErrorsCsv}
          onReset={resetAll}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function UploadCard({
  parsing,
  fileName,
  parseError,
  onPick,
}: {
  parsing: boolean;
  fileName: string | null;
  parseError: string | null;
  onPick: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload Bolna call export</CardTitle>
        <CardDescription>
          Drop in the CSV exported from the voice agent dashboard. The importer
          detects the standard export columns and creates calls + links them to
          existing leads by phone number.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <button
          type="button"
          onClick={onPick}
          disabled={parsing}
          className="flex w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-12 text-center transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {parsing ? (
            <Loader2Icon className="size-8 animate-spin text-muted-foreground" />
          ) : (
            <UploadCloudIcon className="size-8 text-muted-foreground" />
          )}
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {parsing
                ? `Parsing ${fileName ?? "file"}…`
                : "Click to choose a CSV file"}
            </p>
            <p className="text-xs text-muted-foreground">
              Required columns: {REQUIRED_BOLNA_HEADERS.join(", ")}
            </p>
          </div>
        </button>

        {parseError ? (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <XCircleIcon className="mt-0.5 size-4 shrink-0" />
            <span>{parseError}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function PreviewCard({
  fileName,
  totalRows,
  totalIssues,
  rowsWithoutId,
  rowsWithoutAgent,
  rowsWithoutPhone,
  sample,
  onCancel,
  onImport,
}: {
  fileName: string;
  totalRows: number;
  totalIssues: number;
  rowsWithoutId: number;
  rowsWithoutAgent: number;
  rowsWithoutPhone: number;
  sample: ParsedRow[];
  onCancel: () => void;
  onImport: () => void;
}) {
  const blockedRows = rowsWithoutId + rowsWithoutAgent;
  const importable = totalRows - blockedRows;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheetIcon className="size-4 text-muted-foreground" />
          {fileName}
        </CardTitle>
        <CardDescription>
          {totalRows} row{totalRows === 1 ? "" : "s"} parsed.{" "}
          {totalIssues === 0
            ? "No pre-flight issues."
            : `${totalIssues} pre-flight issue${
                totalIssues === 1 ? "" : "s"
              } detected.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Total rows" value={totalRows} />
          <Stat label="Will be imported" value={importable} tone="ok" />
          <Stat
            label="Missing call id"
            value={rowsWithoutId}
            tone={rowsWithoutId > 0 ? "warn" : "muted"}
          />
          <Stat
            label="Missing agent_id"
            value={rowsWithoutAgent}
            tone={rowsWithoutAgent > 0 ? "warn" : "muted"}
          />
        </div>
        {rowsWithoutPhone > 0 ? (
          <p className="flex items-start gap-2 rounded-md border border-amber-200/60 bg-amber-50/40 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/5 dark:text-amber-200">
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
            {rowsWithoutPhone} row{rowsWithoutPhone === 1 ? "" : "s"} have no
            phone number — the call will be created but won&apos;t be linked
            to any lead.
          </p>
        ) : null}

        <div className="rounded-md border border-border/60">
          <div className="border-b border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground">
            First 10 rows
          </div>
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Call id</th>
                  <th className="px-3 py-2 text-left font-medium">Phone</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Duration</th>
                  <th className="px-3 py-2 text-left font-medium">Extracted</th>
                  <th className="px-3 py-2 text-left font-medium">Issues</th>
                </tr>
              </thead>
              <tbody>
                {sample.map((r) => {
                  // Count fields across every category, not just lead_data.
                  // A 3-key lead_data + 2-key finance row shows "5 fields".
                  let fieldCount = 0;
                  for (const fields of Object.values(r.payload.extracted_data)) {
                    fieldCount += Object.keys(fields).length;
                  }
                  return (
                  <tr key={r.payload.id || Math.random()} className="border-t border-border/40">
                    <td className="px-3 py-2 font-mono text-[11px]">
                      {r.payload.id || (
                        <span className="text-destructive">missing</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{r.payload.user_number ?? "—"}</td>
                    <td className="px-3 py-2">{r.payload.status ?? "—"}</td>
                    <td className="px-3 py-2">
                      {r.payload.duration === null
                        ? "—"
                        : `${Math.round(r.payload.duration)}s`}
                    </td>
                    <td className="px-3 py-2">
                      {fieldCount > 0 ? (
                        <Badge variant="secondary" className="text-[10px]">
                          {fieldCount} field{fieldCount === 1 ? "" : "s"}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">none</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-amber-700 dark:text-amber-300">
                      {r.issues.length === 0
                        ? ""
                        : r.issues
                            .map((i) => i.message)
                            .join(", ")
                            .slice(0, 80)}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onImport} disabled={importable === 0}>
            Import {importable} row{importable === 1 ? "" : "s"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function ProgressCard({
  stage,
  progress,
  totals,
  errorCount,
  onDownloadErrors,
  onReset,
}: {
  stage: "importing" | "done";
  progress: { done: number; total: number };
  totals: RunningTotals;
  errorCount: number;
  onDownloadErrors: () => void;
  onReset: () => void;
}) {
  const pct =
    progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {stage === "importing" ? (
            <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-400" />
          )}
          {stage === "importing" ? "Importing…" : "Import complete"}
        </CardTitle>
        <CardDescription>
          {stage === "importing"
            ? `Processed ${progress.done} of ${progress.total} rows`
            : `Processed ${progress.total} rows`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Stat label="Imported" value={totals.imported} tone="ok" />
          <Stat label="Updated" value={totals.updated} tone="muted" />
          <Stat
            label="Errored"
            value={totals.errored}
            tone={totals.errored > 0 ? "warn" : "muted"}
          />
        </div>

        {stage === "done" ? (
          <div className="flex flex-wrap justify-end gap-2">
            {errorCount > 0 ? (
              <Button variant="outline" onClick={onDownloadErrors}>
                <DownloadIcon /> Download errors ({errorCount})
              </Button>
            ) : null}
            <Button onClick={onReset}>Import another file</Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function Stat({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn" | "muted";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-700 dark:text-emerald-300"
      : tone === "warn"
        ? "text-amber-700 dark:text-amber-300"
        : "text-foreground";
  return (
    <div className="rounded-md border border-border/60 bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`text-2xl font-semibold tabular-nums ${toneClass}`}>
        {value}
      </div>
    </div>
  );
}
