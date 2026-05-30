"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  createOrgDashboardWidget,
  updateOrgDashboardWidget,
} from "@/actions/admin/dashboard-widgets";
import {
  type WidgetChartType,
  sqlWidgetConfigSchema,
} from "@/lib/validations/dashboard-widget";
import type { OrgDashboardWidget } from "@/types/dashboard-widget";

// SQL-authored widget. The admin writes a single read-only SELECT; the
// execute_dashboard_sql RPC runs it scoped to the org (RLS), SELECT-only,
// with a statement timeout and row cap. The query must return three columns
// in order — a text label, a text group (or NULL), and a numeric value —
// matching the same (dim_a, dim_b, value) contract the chart renderers use.

const CHART_OPTIONS: Array<{
  value: WidgetChartType;
  label: string;
  hint: string;
}> = [
  { value: "stat_card", label: "Stat card", hint: "Return one row: label, null, value" },
  { value: "bar", label: "Bar chart", hint: "One row per bar: label, null, value" },
  { value: "pie", label: "Pie chart", hint: "One row per slice: label, null, value" },
  { value: "line", label: "Line chart", hint: "One row per point: period, null, value" },
  { value: "pivot", label: "Pivot table", hint: "One row per cell: row, column, value" },
];

const SAMPLE_SQL = `select status as label, null::text as grp, count(*) as value
from leads
group by status
order by value desc`;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organisationId: string;
  editing: OrgDashboardWidget | null;
  onSaved: () => void;
}

export function SqlWidgetDialog({
  open,
  onOpenChange,
  organisationId,
  editing,
  onSaved,
}: Props) {
  const [title, setTitle] = React.useState("");
  const [sql, setSql] = React.useState("");
  const [chartType, setChartType] = React.useState<WidgetChartType>("bar");
  const [pending, setPending] = React.useState(false);

  // Reset on open (mirrors the builder dialog — avoids set-state-in-effect).
  function handleOpenChange(next: boolean) {
    if (next && !open) {
      if (editing && editing.config.kind === "sql") {
        setTitle(editing.title);
        setSql(editing.config.sql);
        setChartType(editing.config.chart_type);
      } else {
        setTitle("");
        setSql("");
        setChartType("bar");
      }
    }
    onOpenChange(next);
  }

  async function onSubmit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast.error("Title is required.");
      return;
    }
    const parsed = sqlWidgetConfigSchema.safeParse({
      kind: "sql",
      sql,
      chart_type: chartType,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid SQL widget");
      return;
    }

    setPending(true);
    try {
      if (editing) {
        const res = await updateOrgDashboardWidget({
          id: editing.id,
          organisation_id: organisationId,
          title: trimmedTitle,
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
          title: trimmedTitle,
          config: parsed.data,
          enabled: true,
        });
        if (!res.success) {
          toast.error(res.error);
          return;
        }
        toast.success("SQL widget added");
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
            {editing ? "Edit SQL widget" : "Add SQL widget"}
          </DialogTitle>
          <DialogDescription>
            Write a single read-only SELECT. It runs scoped to this org, is
            SELECT-only, and is capped by a timeout and row limit. Return three
            columns, in order: a text label, a text group (or NULL), and a
            numeric value.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[60vh] gap-5 overflow-y-auto pr-1">
          <Field label="Title">
            <Input
              placeholder="e.g. Leads by status (SQL)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={pending}
            />
          </Field>

          <Field label="Chart type">
            <Select
              value={chartType}
              onValueChange={(v) =>
                v !== null && setChartType(v as WidgetChartType)
              }
              disabled={pending}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {CHART_OPTIONS.find((o) => o.value === chartType)?.label}
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
          </Field>

          <Field label="SQL query">
            <Textarea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              placeholder={SAMPLE_SQL}
              spellCheck={false}
              className="min-h-40 font-mono text-xs"
              disabled={pending}
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Single <code className="rounded bg-muted px-1">SELECT</code> /{" "}
              <code className="rounded bg-muted px-1">WITH</code> only — no
              INSERT/UPDATE/DELETE/DDL. The query is scoped to this org by row-
              level security, so you don&apos;t need to (and can&apos;t rely on)
              filtering by organisation yourself.
            </p>
          </Field>
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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
