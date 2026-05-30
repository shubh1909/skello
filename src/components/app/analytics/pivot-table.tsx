"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export interface PivotCell {
  row: string;
  column: string;
  value: number;
}

interface Props {
  data: PivotCell[];
  rowHeader?: string;
  columnHeader?: string;
  emptyLabel?: string;
}

// Renders a row × column matrix from the {dim_a, dim_b, value} rows
// emitted by execute_dashboard_widget. Each cell carries an
// intensity-driven background so the matrix doubles as a heatmap —
// useful for spotting hotspots without needing a dedicated
// visualisation. Totals are rendered along the right/bottom edge so
// the table is self-summarising.
//
// Behaviour notes:
//  * Rows are sorted by row label asc; columns by total desc so the
//    biggest column lives leftmost — most spreadsheet pivots favour
//    that read order.
//  * Heatmap shading: cell opacity = value / global_max, clamped to
//    a 0.05 floor so populated cells are always discernible from
//    truly empty ones.

export function PivotTable({
  data,
  rowHeader = "Row",
  columnHeader = "Column",
  emptyLabel = "No data",
}: Props) {
  const { rows, columns, cellMap, max, rowTotals, columnTotals, grandTotal } =
    React.useMemo(() => shape(data), [data]);

  if (rows.length === 0 || columns.length === 0 || max === 0) {
    return (
      <div className="grid h-full place-items-center py-8 text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border/60 text-xs uppercase tracking-wider text-muted-foreground">
            <th
              scope="col"
              className="sticky left-0 z-10 bg-background px-3 py-2 text-left font-medium"
            >
              {rowHeader} \ {columnHeader}
            </th>
            {columns.map((c) => (
              <th
                key={c}
                scope="col"
                className="px-3 py-2 text-right font-medium"
              >
                {c || "—"}
              </th>
            ))}
            <th
              scope="col"
              className="border-l border-border/60 px-3 py-2 text-right font-medium"
            >
              Total
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((r) => {
            const rowTotal = rowTotals.get(r) ?? 0;
            return (
              <tr key={r} className="group">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-background px-3 py-2 text-left text-sm font-medium"
                >
                  {r || "—"}
                </th>
                {columns.map((c) => {
                  const v = cellMap.get(key(r, c)) ?? 0;
                  const intensity = v === 0 ? 0 : Math.max(0.05, v / max);
                  return (
                    <td
                      key={c}
                      className={cn(
                        "px-3 py-2 text-right font-mono text-sm tabular-nums",
                        v === 0 && "text-muted-foreground/60",
                      )}
                      style={{
                        backgroundColor:
                          v === 0
                            ? undefined
                            : `color-mix(in srgb, var(--color-foreground) ${(
                                intensity * 18
                              ).toFixed(1)}%, transparent)`,
                      }}
                    >
                      {v === 0 ? "—" : v.toLocaleString()}
                    </td>
                  );
                })}
                <td className="border-l border-border/60 px-3 py-2 text-right font-mono text-sm font-semibold tabular-nums">
                  {rowTotal.toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t-2 border-border/80 text-sm font-semibold">
          <tr>
            <th
              scope="row"
              className="sticky left-0 z-10 bg-background px-3 py-2 text-left"
            >
              Total
            </th>
            {columns.map((c) => (
              <td
                key={c}
                className="px-3 py-2 text-right font-mono tabular-nums"
              >
                {(columnTotals.get(c) ?? 0).toLocaleString()}
              </td>
            ))}
            <td className="border-l border-border/60 px-3 py-2 text-right font-mono tabular-nums">
              {grandTotal.toLocaleString()}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function key(r: string, c: string): string {
  return `${r}${c}`;
}

function shape(data: PivotCell[]) {
  const cellMap = new Map<string, number>();
  const rowSet = new Set<string>();
  const columnTotals = new Map<string, number>();
  const rowTotals = new Map<string, number>();
  let max = 0;
  let grandTotal = 0;

  for (const cell of data) {
    if (!Number.isFinite(cell.value)) continue;
    const r = cell.row ?? "";
    const c = cell.column ?? "";
    cellMap.set(key(r, c), (cellMap.get(key(r, c)) ?? 0) + cell.value);
    rowSet.add(r);
    columnTotals.set(c, (columnTotals.get(c) ?? 0) + cell.value);
    rowTotals.set(r, (rowTotals.get(r) ?? 0) + cell.value);
    grandTotal += cell.value;
    const v = cellMap.get(key(r, c)) ?? 0;
    if (v > max) max = v;
  }

  const rows = Array.from(rowSet).sort((a, b) => a.localeCompare(b));
  const columns = Array.from(columnTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);

  return { rows, columns, cellMap, max, rowTotals, columnTotals, grandTotal };
}
