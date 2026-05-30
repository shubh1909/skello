"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BarChartBigIcon,
  ChartPieIcon,
  Code2Icon,
  GaugeIcon,
  GridIcon,
  HashIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  TrendingUpIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { WidgetRenderer } from "@/components/app/analytics/widget-renderer";
import { WidgetBuilderDialog } from "@/components/admin/dashboard/widget-builder-dialog";
import { SqlWidgetDialog } from "@/components/admin/dashboard/sql-widget-dialog";
import {
  deleteOrgDashboardWidget,
  reorderOrgDashboardWidgets,
  updateOrgDashboardWidget,
} from "@/actions/admin/dashboard-widgets";
import { cn } from "@/lib/utils";
import type {
  WidgetChartType,
  WidgetExecuteRow,
} from "@/lib/validations/dashboard-widget";
import type {
  OrgDashboardWidget,
  SourceCatalogEntry,
} from "@/types/dashboard-widget";

interface Props {
  organisationId: string;
  initialWidgets: OrgDashboardWidget[];
  catalog: SourceCatalogEntry[];
  // Server-side execution result, keyed by widget id. Drives the
  // inline preview under each row so the admin sees the actual chart
  // (not just a chart-type label). Empty array = the widget ran but
  // matched zero rows; missing key = execution failed, the renderer
  // falls back to the empty state.
  rowsById: Record<string, WidgetExecuteRow[]>;
}

const CHART_ICON: Record<WidgetChartType, React.ComponentType<{ className?: string }>> =
  {
    stat_card: HashIcon,
    bar: BarChartBigIcon,
    pie: ChartPieIcon,
    line: TrendingUpIcon,
    pivot: GridIcon,
  };

const CHART_LABEL: Record<WidgetChartType, string> = {
  stat_card: "Stat card",
  bar: "Bar chart",
  pie: "Pie chart",
  line: "Line chart",
  pivot: "Pivot table",
};

export function WidgetListClient({
  organisationId,
  initialWidgets,
  catalog,
  rowsById,
}: Props) {
  const router = useRouter();
  // Optimistic reorder buffer. When the user clicks an up/down arrow
  // we update `pendingOrder` immediately so the UI feels instant; the
  // server action runs in a transition, and on success we clear
  // the buffer. router.refresh() then re-renders the parent with
  // the new authoritative `initialWidgets`. No useEffect — keeps us
  // clear of react-hooks/set-state-in-effect.
  const [pendingOrder, setPendingOrder] = React.useState<string[] | null>(
    null,
  );
  const widgets = React.useMemo(() => {
    if (!pendingOrder) return initialWidgets;
    const map = new Map(initialWidgets.map((w) => [w.id, w]));
    const reordered = pendingOrder.flatMap((id) => {
      const w = map.get(id);
      return w ? [w] : [];
    });
    // Fallback: if pendingOrder has gone stale (e.g. a widget was
    // deleted server-side), append anything we missed so nothing
    // vanishes from the list.
    const seen = new Set(pendingOrder);
    for (const w of initialWidgets) {
      if (!seen.has(w.id)) reordered.push(w);
    }
    return reordered;
  }, [initialWidgets, pendingOrder]);

  const [pending, startTransition] = React.useTransition();
  const [builderOpen, setBuilderOpen] = React.useState(false);
  const [sqlOpen, setSqlOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<OrgDashboardWidget | null>(null);

  function openCreate() {
    setEditing(null);
    setBuilderOpen(true);
  }
  function openCreateSql() {
    setEditing(null);
    setSqlOpen(true);
  }
  function openEdit(widget: OrgDashboardWidget) {
    setEditing(widget);
    // SQL widgets edit in their own dialog; builder widgets in the builder.
    if (widget.config.kind === "sql") {
      setSqlOpen(true);
    } else {
      setBuilderOpen(true);
    }
  }
  function onToggle(widget: OrgDashboardWidget) {
    startTransition(async () => {
      const res = await updateOrgDashboardWidget({
        id: widget.id,
        organisation_id: organisationId,
        enabled: !widget.enabled,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }
  function onDelete(widget: OrgDashboardWidget) {
    if (!confirm(`Delete "${widget.title}"?`)) return;
    startTransition(async () => {
      const res = await deleteOrgDashboardWidget({
        id: widget.id,
        organisation_id: organisationId,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Widget removed");
      router.refresh();
    });
  }
  function onMove(widget: OrgDashboardWidget, direction: -1 | 1) {
    const idx = widgets.findIndex((w) => w.id === widget.id);
    const next = idx + direction;
    if (next < 0 || next >= widgets.length) return;
    const reordered = [...widgets];
    [reordered[idx], reordered[next]] = [reordered[next], reordered[idx]];
    const orderedIds = reordered.map((w) => w.id);
    // Optimistic update — the UI shows the new order immediately.
    setPendingOrder(orderedIds);
    startTransition(async () => {
      const res = await reorderOrgDashboardWidgets({
        organisation_id: organisationId,
        ordered_ids: orderedIds,
      });
      if (!res.success) {
        toast.error(res.error);
        setPendingOrder(null);
        return;
      }
      // Server now matches the optimistic state; clear the buffer and
      // let the parent's router.refresh land authoritative data.
      setPendingOrder(null);
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {widgets.length === 0
            ? "No widgets yet. Add one to start composing this org's dashboard."
            : `${widgets.length} widget${widgets.length === 1 ? "" : "s"} configured`}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={openCreateSql}>
            <Code2Icon /> Add SQL widget
          </Button>
          <Button onClick={openCreate}>
            <PlusIcon /> Add widget
          </Button>
        </div>
      </div>

      {widgets.length === 0 ? (
        <Card className="items-center gap-3 py-16 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-muted">
            <GaugeIcon className="size-6 text-muted-foreground" />
          </span>
          <p className="text-base font-medium">No custom widgets yet</p>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            Until you add a widget, this workspace sees the default Skelo
            dashboard. Pick a data source — leads, calls, or campaigns — and
            decide how it should be visualised.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button onClick={openCreate}>
              <PlusIcon /> Add the first widget
            </Button>
            <Button variant="outline" onClick={openCreateSql}>
              <Code2Icon /> Use SQL
            </Button>
          </div>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {widgets.map((widget, idx) => {
            const Icon = CHART_ICON[widget.config.chart_type];
            const isFirst = idx === 0;
            const isLast = idx === widgets.length - 1;
            const rows = rowsById[widget.id] ?? [];
            return (
              <li key={widget.id}>
                <Card
                  className={cn(
                    "gap-0 p-0",
                    !widget.enabled && "opacity-60",
                  )}
                >
                  <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        aria-label="Move up"
                        disabled={isFirst || pending}
                        onClick={() => onMove(widget, -1)}
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                      >
                        <ArrowUpIcon className="size-3" />
                      </button>
                      <button
                        type="button"
                        aria-label="Move down"
                        disabled={isLast || pending}
                        onClick={() => onMove(widget, 1)}
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                      >
                        <ArrowDownIcon className="size-3" />
                      </button>
                    </div>

                    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                      <Icon className="size-4" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">
                          {widget.title}
                        </p>
                        <Badge variant="outline" className="text-[10px]">
                          {CHART_LABEL[widget.config.chart_type]}
                        </Badge>
                        {!widget.enabled ? (
                          <Badge variant="outline" className="text-[10px]">
                            Hidden
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {summarise(widget)}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onToggle(widget)}
                        disabled={pending}
                      >
                        {widget.enabled ? "Hide" : "Show"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEdit(widget)}
                        aria-label="Edit"
                        disabled={pending}
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onDelete(widget)}
                        aria-label="Delete"
                        disabled={pending}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </div>

                  {/* Inline preview — renders this widget exactly as the
                      org owner will see it on /dashboard. Built from the
                      server-pre-executed rows passed via rowsById; the
                      WidgetRenderer is reused so styling stays in
                      lockstep with the consumer dashboard. */}
                  <div className="p-4">
                    <WidgetRenderer widget={widget} rows={rows} />
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <WidgetBuilderDialog
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        organisationId={organisationId}
        catalog={catalog}
        editing={editing}
        onSaved={() => {
          setBuilderOpen(false);
          router.refresh();
        }}
      />

      <SqlWidgetDialog
        open={sqlOpen}
        onOpenChange={setSqlOpen}
        organisationId={organisationId}
        editing={editing}
        onSaved={() => {
          setSqlOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}

function summarise(widget: OrgDashboardWidget): string {
  const cfg = widget.config;
  if (cfg.kind === "sql") {
    const oneLine = cfg.sql.replace(/\s+/g, " ").trim();
    return `SQL · ${oneLine.length > 64 ? `${oneLine.slice(0, 64)}…` : oneLine}`;
  }
  const parts: string[] = [];
  parts.push(cfg.source);
  parts.push(`${cfg.metric.op}${cfg.metric.column ? `(${cfg.metric.column})` : ""}`);
  if (cfg.row_dimension) {
    parts.push(`by ${cfg.row_dimension.key}${cfg.row_dimension.bucket ? `/${cfg.row_dimension.bucket}` : ""}`);
  }
  if (cfg.column_dimension) {
    parts.push(`× ${cfg.column_dimension.key}`);
  }
  if (cfg.filters.length > 0) {
    parts.push(`${cfg.filters.length} filter${cfg.filters.length === 1 ? "" : "s"}`);
  }
  parts.push(cfg.range.replace("_", " "));
  return parts.join(" · ");
}
