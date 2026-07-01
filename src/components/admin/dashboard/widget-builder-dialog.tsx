"use client";

import * as React from "react";
import { Loader2Icon, PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createOrgDashboardWidget,
  updateOrgDashboardWidget,
} from "@/actions/admin/dashboard-widgets";
import {
  type BuilderWidgetConfig,
  type WidgetChartType,
  type WidgetDimension,
  type WidgetFilter,
  type WidgetMetricOp,
  type WidgetRange,
  type WidgetSource,
  type WidgetTimeBucket,
  builderWidgetConfigSchema,
} from "@/lib/validations/dashboard-widget";
import type {
  OrgDashboardWidget,
  SourceCatalogColumn,
  SourceCatalogEntry,
} from "@/types/dashboard-widget";

// Single-form widget builder. Source → metric → row dimension → column
// dimension (pivot only) → filters → range → chart type. The form
// dynamically greys-out fields that don't apply for the chosen chart
// type (e.g. column dimension is only enabled for pivot tables).
//
// All validation reuses the same Zod schema the server enforces, so
// the error message the admin sees here matches what the action would
// return. The SQL allowlist in the migration is the last line of
// defence — admins who craft a payload outside the catalog get a
// 22023 from Postgres.

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organisationId: string;
  catalog: SourceCatalogEntry[];
  editing: OrgDashboardWidget | null;
  onSaved: () => void;
}

const CHART_OPTIONS: Array<{
  value: WidgetChartType;
  label: string;
  hint: string;
}> = [
  { value: "stat_card", label: "Stat card", hint: "One number, no dimensions" },
  { value: "bar", label: "Bar chart", hint: "Group by 1 dimension" },
  { value: "pie", label: "Pie chart", hint: "Share by 1 dimension" },
  { value: "line", label: "Line chart", hint: "Trend over time (bucketed)" },
  { value: "pivot", label: "Pivot table", hint: "Group by 2 dimensions" },
];

const RANGE_OPTIONS: Array<{ value: WidgetRange; label: string }> = [
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "last_90_days", label: "Last 90 days" },
  { value: "last_180_days", label: "Last 180 days" },
  { value: "last_365_days", label: "Last 365 days" },
  { value: "all", label: "All time" },
];

const OPS: Array<{ value: WidgetMetricOp; label: string }> = [
  { value: "count", label: "Count (rows)" },
  { value: "count_distinct", label: "Count distinct (column)" },
  { value: "sum", label: "Sum (column)" },
  { value: "avg", label: "Average (column)" },
  { value: "min", label: "Min (column)" },
  { value: "max", label: "Max (column)" },
];

const FILTER_OPS: Array<{ value: WidgetFilter["op"]; label: string }> = [
  { value: "eq", label: "is" },
  { value: "neq", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
];

const BUCKETS: Array<{ value: WidgetTimeBucket; label: string }> = [
  { value: "day", label: "By day" },
  { value: "week", label: "By week" },
  { value: "month", label: "By month" },
];

function defaultConfig(): BuilderWidgetConfig {
  return {
    kind: "builder",
    source: "leads",
    metric: { op: "count" },
    range: "last_30_days",
    filters: [],
    chart_type: "stat_card",
  };
}

export function WidgetBuilderDialog({
  open,
  onOpenChange,
  organisationId,
  catalog,
  editing,
  onSaved,
}: Props) {
  const [title, setTitle] = React.useState("");
  const [cfg, setCfg] = React.useState<BuilderWidgetConfig>(defaultConfig());
  const [pending, setPending] = React.useState(false);

  // Reset state when the dialog flips to open. Lives in onOpenChange
  // rather than useEffect (see react-hooks/set-state-in-effect rule).
  function handleOpenChange(next: boolean) {
    if (next && !open) {
      if (editing && editing.config.kind !== "sql") {
        setTitle(editing.title);
        setCfg(editing.config);
      } else {
        setTitle("");
        setCfg(defaultConfig());
      }
    }
    onOpenChange(next);
  }

  const sourceCatalog =
    catalog.find((c) => c.source === cfg.source) ?? catalog[0];

  // Column choices that vary with source.
  const dimensionColumns = sourceCatalog?.dimensions ?? [];
  const filterableColumns = sourceCatalog?.filterables ?? [];
  const metricColumns = sourceCatalog?.metric_columns ?? [];

  // Field gating per chart type. Mirrors the Zod superRefine.
  const needsRow = cfg.chart_type !== "stat_card";
  const needsCol = cfg.chart_type === "pivot";
  const requiresBucket = cfg.chart_type === "line";

  function patchCfg(patch: Partial<BuilderWidgetConfig>) {
    setCfg((prev) => ({ ...prev, ...patch }));
  }

  function onSourceChange(value: string) {
    if (
      value === "leads" ||
      value === "calls" ||
      value === "campaigns" ||
      value === "recovery"
    ) {
      // Switching source invalidates dimension/metric columns. Reset
      // them so the form doesn't carry over a key that doesn't exist
      // on the new source.
      patchCfg({
        source: value as WidgetSource,
        metric: { op: "count" },
        row_dimension: undefined,
        column_dimension: undefined,
        filters: [],
      });
    }
  }
  function onChartTypeChange(value: string) {
    const next = value as WidgetChartType;
    const patch: Partial<BuilderWidgetConfig> = { chart_type: next };
    if (next === "stat_card") {
      patch.row_dimension = undefined;
      patch.column_dimension = undefined;
    } else if (next !== "pivot") {
      patch.column_dimension = undefined;
    }
    // Drop a stale bucket when switching off line chart.
    if (next !== "line" && cfg.row_dimension?.bucket) {
      patch.row_dimension = { ...cfg.row_dimension, bucket: undefined };
    }
    patchCfg(patch);
  }
  function onMetricOpChange(value: string) {
    const op = value as WidgetMetricOp;
    if (op === "count") {
      patchCfg({ metric: { op } });
    } else {
      // Auto-pick the first valid column so the form doesn't sit in
      // an invalid state. Admin can change it via the column select.
      const col =
        cfg.metric.column ?? metricColumns[0]?.key ?? undefined;
      patchCfg({ metric: { op, column: col } });
    }
  }
  function onRowDimensionPick(column: SourceCatalogColumn | null) {
    if (!column) {
      patchCfg({ row_dimension: undefined });
      return;
    }
    const dim = columnToDimension(column);
    if (requiresBucket && column.time_bucketable) {
      dim.bucket = cfg.row_dimension?.bucket ?? "day";
    }
    patchCfg({ row_dimension: dim });
  }
  function onColumnDimensionPick(column: SourceCatalogColumn | null) {
    if (!column) {
      patchCfg({ column_dimension: undefined });
      return;
    }
    patchCfg({ column_dimension: columnToDimension(column) });
  }
  function onBucketChange(value: string) {
    if (!cfg.row_dimension) return;
    patchCfg({
      row_dimension: { ...cfg.row_dimension, bucket: value as WidgetTimeBucket },
    });
  }

  function onAddFilter() {
    if (filterableColumns.length === 0) return;
    const first = filterableColumns[0];
    patchCfg({
      filters: [
        ...cfg.filters,
        {
          source: dimensionSource(first),
          category: filterCategory(first),
          key: filterKey(first),
          op: first.data_type === "string" ? "contains" : "eq",
          value: "",
        },
      ],
    });
  }
  function onUpdateFilter(idx: number, patch: Partial<WidgetFilter>) {
    patchCfg({
      filters: cfg.filters.map((f, i) => (i === idx ? { ...f, ...patch } : f)),
    });
  }
  function onRemoveFilter(idx: number) {
    patchCfg({
      filters: cfg.filters.filter((_, i) => i !== idx),
    });
  }
  function onFilterColumnPick(idx: number, column: SourceCatalogColumn) {
    onUpdateFilter(idx, {
      source: dimensionSource(column),
      category: filterCategory(column),
      key: filterKey(column),
      op: column.data_type === "string" ? "contains" : "eq",
      value: "",
    });
  }

  async function onSubmit() {
    const trimmed = title.trim();
    if (!trimmed) {
      toast.error("Title is required.");
      return;
    }
    const parsed = builderWidgetConfigSchema.safeParse(cfg);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid config");
      return;
    }
    setPending(true);
    try {
      if (editing) {
        const res = await updateOrgDashboardWidget({
          id: editing.id,
          organisation_id: organisationId,
          title: trimmed,
          config: parsed.data,
        });
        if (!res.success) {
          toast.error(res.error);
          return;
        }
        toast.success("Widget updated");
      } else {
        const res = await createOrgDashboardWidget({
          organisation_id: organisationId,
          title: trimmed,
          config: parsed.data,
          enabled: true,
        });
        if (!res.success) {
          toast.error(res.error);
          return;
        }
        toast.success("Widget added");
      }
      onSaved();
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit widget" : "Add widget"}
          </DialogTitle>
          <DialogDescription>
            Pick a data source, decide what to count, group it, and choose how
            to render. The org will see the widget on /dashboard.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[60vh] gap-5 overflow-y-auto pr-1">
          {/* Title */}
          <Section label="Title">
            <Input
              placeholder="e.g. Leads by status — last 30 days"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={pending}
            />
          </Section>

          {/* Source */}
          <Section label="Data source">
            <Select
              value={cfg.source}
              onValueChange={(v) => v !== null && onSourceChange(v)}
              disabled={pending}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {catalog.find((c) => c.source === cfg.source)?.label ??
                    cfg.source}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {catalog.map((c) => (
                  <SelectItem key={c.source} value={c.source}>
                    <div className="flex flex-col">
                      <span>{c.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {c.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Section>

          {/* Metric */}
          <Section label="Metric">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <Select
                value={cfg.metric.op}
                onValueChange={(v) => v !== null && onMetricOpChange(v)}
                disabled={pending}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {OPS.find((o) => o.value === cfg.metric.op)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {OPS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {cfg.metric.op !== "count" ? (
                <Select
                  value={cfg.metric.column ?? ""}
                  onValueChange={(v) =>
                    v !== null &&
                    patchCfg({ metric: { ...cfg.metric, column: v } })
                  }
                  disabled={pending}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pick a column">
                      {metricColumns.find((c) => c.key === cfg.metric.column)
                        ?.label ?? "Pick a column"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {metricColumns.map((c) => (
                      <SelectItem key={c.key} value={c.key}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="self-center text-xs text-muted-foreground">
                  Counts every matching row.
                </p>
              )}
            </div>
          </Section>

          {/* Chart type */}
          <Section label="Chart type">
            <Select
              value={cfg.chart_type}
              onValueChange={(v) => v !== null && onChartTypeChange(v)}
              disabled={pending}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {CHART_OPTIONS.find((o) => o.value === cfg.chart_type)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {CHART_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <div className="flex flex-col">
                      <span>{o.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {o.hint}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Section>

          {/* Row dimension */}
          {needsRow ? (
            <Section
              label={needsCol ? "Row dimension (group by rows)" : "Group by"}
            >
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <DimensionPicker
                  columns={dimensionColumns}
                  value={cfg.row_dimension ?? null}
                  onChange={onRowDimensionPick}
                  disabled={pending}
                />
                {requiresBucket && cfg.row_dimension?.bucket ? (
                  <Select
                    value={cfg.row_dimension.bucket}
                    onValueChange={(v) => v !== null && onBucketChange(v)}
                    disabled={pending}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {BUCKETS.find(
                          (b) => b.value === cfg.row_dimension?.bucket,
                        )?.label}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {BUCKETS.map((b) => (
                        <SelectItem key={b.value} value={b.value}>
                          {b.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
              </div>
            </Section>
          ) : null}

          {/* Column dimension (pivot only) */}
          {needsCol ? (
            <Section label="Column dimension (group by columns)">
              <DimensionPicker
                columns={dimensionColumns}
                value={cfg.column_dimension ?? null}
                onChange={onColumnDimensionPick}
                disabled={pending}
              />
            </Section>
          ) : null}

          {/* Filters */}
          <Section
            label="Filters"
            action={
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onAddFilter}
                disabled={pending || filterableColumns.length === 0}
              >
                <PlusIcon /> Add filter
              </Button>
            }
          >
            {cfg.filters.length === 0 ? (
              <p className="rounded-md border border-dashed border-border/70 py-3 text-center text-xs text-muted-foreground">
                No filters — the widget will aggregate the whole range.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {cfg.filters.map((f, idx) => {
                  const matchingColumn = filterableColumns.find((c) =>
                    sameColumn(c, f),
                  );
                  return (
                    <li
                      key={`${idx}-${f.key}`}
                      className="grid grid-cols-[minmax(0,1.4fr)_auto_minmax(0,1fr)_auto] items-center gap-2"
                    >
                      <Select
                        value={matchingColumn?.key ?? ""}
                        onValueChange={(v) => {
                          if (v === null) return;
                          const next = filterableColumns.find(
                            (c) => c.key === v,
                          );
                          if (next) onFilterColumnPick(idx, next);
                        }}
                        disabled={pending}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {matchingColumn?.label ?? f.key}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {filterableColumns.map((c) => (
                            <SelectItem key={c.key} value={c.key}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={f.op}
                        onValueChange={(v) =>
                          v !== null &&
                          onUpdateFilter(idx, {
                            op: v as WidgetFilter["op"],
                          })
                        }
                        disabled={pending}
                      >
                        <SelectTrigger className="w-[110px]">
                          <SelectValue>
                            {FILTER_OPS.find((o) => o.value === f.op)?.label}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {FILTER_OPS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FilterValueInput
                        column={matchingColumn}
                        op={f.op}
                        value={f.value}
                        onChange={(value) => onUpdateFilter(idx, { value })}
                        disabled={pending}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onRemoveFilter(idx)}
                        aria-label="Remove filter"
                        disabled={pending}
                      >
                        <XIcon />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {/* Range */}
          <Section label="Time range">
            <Select
              value={cfg.range}
              onValueChange={(v) =>
                v !== null && patchCfg({ range: v as WidgetRange })
              }
              disabled={pending}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {RANGE_OPTIONS.find((o) => o.value === cfg.range)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Section>
        </div>

        <DialogFooter>
          <DialogClose
            render={
              <Button type="button" variant="outline" disabled={pending} />
            }
          >
            Cancel
          </DialogClose>
          <Button type="button" onClick={onSubmit} disabled={pending}>
            {pending ? <Loader2Icon className="animate-spin" /> : null}
            {editing ? "Save changes" : "Add widget"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </Label>
        {action}
      </div>
      {children}
    </div>
  );
}

function DimensionPicker({
  columns,
  value,
  onChange,
  disabled,
}: {
  columns: SourceCatalogColumn[];
  value: WidgetDimension | null;
  onChange: (column: SourceCatalogColumn | null) => void;
  disabled?: boolean;
}) {
  const selectedKey = value
    ? value.source === "column"
      ? value.key
      : `${value.source}:${value.category ?? ""}:${value.key}`
    : "";
  return (
    <Select
      value={selectedKey}
      onValueChange={(v) => {
        if (v === null) return;
        const col = columns.find((c) => c.key === v);
        onChange(col ?? null);
      }}
      disabled={disabled}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Pick a column">
          {columns.find((c) => c.key === selectedKey)?.label ?? "Pick a column"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {columns.map((c) => (
          <SelectItem key={c.key} value={c.key}>
            {c.label}
            {c.time_bucketable ? (
              <span className="ml-1 text-[10px] uppercase text-muted-foreground">
                Date
              </span>
            ) : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// The value control adapts to the picked column's data type so the admin
// gets the right affordance: an enum dropdown, a true/false selector, a
// number spinner, or a datetime picker — falling back to free text. The
// `contains` operator is always a substring match, so it stays a text box
// regardless of the column type.
function FilterValueInput({
  column,
  op,
  value,
  onChange,
  disabled,
}: {
  column: SourceCatalogColumn | undefined;
  op: WidgetFilter["op"];
  value: WidgetFilter["value"];
  onChange: (value: WidgetFilter["value"]) => void;
  disabled?: boolean;
}) {
  const dataType = column?.data_type ?? "string";
  const asText =
    typeof value === "boolean" ? String(value) : String(value ?? "");

  if (op !== "contains") {
    if (dataType === "boolean") {
      const selected =
        value === true ? "true" : value === false ? "false" : "";
      return (
        <Select
          value={selected}
          onValueChange={(v) => v !== null && onChange(v === "true")}
          disabled={disabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="True / False">
              {selected === "true"
                ? "True"
                : selected === "false"
                  ? "False"
                  : "True / False"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">True</SelectItem>
            <SelectItem value="false">False</SelectItem>
          </SelectContent>
        </Select>
      );
    }

    if (dataType === "enum" && column?.enum_options?.length) {
      return (
        <Select
          value={asText}
          onValueChange={(v) => v !== null && onChange(v)}
          disabled={disabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Pick a value">
              {asText || "Pick a value"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {column.enum_options.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    if (dataType === "number") {
      return (
        <Input
          type="number"
          value={asText}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          disabled={disabled}
        />
      );
    }

    if (dataType === "date") {
      return (
        <Input
          type="datetime-local"
          value={asText}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
    }
  }

  return (
    <Input
      type="text"
      value={asText}
      onChange={(e) => onChange(e.target.value)}
      placeholder="value"
      disabled={disabled}
    />
  );
}

// Catalog columns are namespaced (e.g. `lead_data::interest`) when they
// come from a JSONB blob. Turn that into a WidgetDimension shape.
function columnToDimension(c: SourceCatalogColumn): WidgetDimension {
  const parts = c.key.split(":");
  if (parts.length === 3 && (parts[0] === "lead_data" || parts[0] === "custom_data")) {
    return {
      source: parts[0] as WidgetDimension["source"],
      category: parts[1] || undefined,
      key: parts[2],
    };
  }
  return { source: "column", key: c.key };
}

function dimensionSource(c: SourceCatalogColumn): WidgetFilter["source"] {
  const parts = c.key.split(":");
  if (parts.length === 3 && (parts[0] === "lead_data" || parts[0] === "custom_data")) {
    return parts[0] as WidgetFilter["source"];
  }
  return "column";
}

function filterCategory(c: SourceCatalogColumn): string | undefined {
  const parts = c.key.split(":");
  return parts.length === 3 ? parts[1] || undefined : undefined;
}

function filterKey(c: SourceCatalogColumn): string {
  const parts = c.key.split(":");
  return parts.length === 3 ? parts[2] : c.key;
}

function sameColumn(c: SourceCatalogColumn, f: WidgetFilter): boolean {
  if (f.source === "column") return c.key === f.key && !c.key.includes(":");
  const expected = `${f.source}:${f.category ?? ""}:${f.key}`;
  return c.key === expected;
}
