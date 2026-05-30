"use client";

import * as React from "react";
import {
  BarChartBigIcon,
  ChartPieIcon,
  GridIcon,
  HashIcon,
  TrendingUpIcon,
} from "lucide-react";

import { ChartFrame } from "@/components/app/analytics/chart-frame";
import { DailyBarChart } from "@/components/app/analytics/daily-bar-chart";
import { HorizontalBarList } from "@/components/app/analytics/horizontal-bar-list";
import { LineChart } from "@/components/app/analytics/line-chart";
import { PieChart } from "@/components/app/analytics/pie-chart";
import { PivotTable } from "@/components/app/analytics/pivot-table";
import { StatCard } from "@/components/app/stat-card";
import type { WidgetExecuteRow } from "@/lib/validations/dashboard-widget";
import type { OrgDashboardWidget } from "@/types/dashboard-widget";

interface WidgetRendererProps {
  widget: OrgDashboardWidget;
  rows: WidgetExecuteRow[];
  // Subtitle injected by the page so each widget can carry its own
  // range label (e.g. "Last 30 days · Acme Co"). Optional.
  subtitle?: string;
  // When the widget spans two grid columns. Phase 1 uses a simple
  // heuristic — pivot tables and line charts get the wide slot; bar
  // charts in time mode get wide too. Stat cards stay narrow.
  wide?: boolean;
}

// Dispatches a widget's executed rows to the right chart component.
// Each chart type interprets the {dim_a, dim_b, value} contract
// differently — the conversions live here so the chart components
// stay generic (they could be reused outside the dashboard).
//
// Stat-card widgets render via the existing StatCard so the layout
// matches the four headline cards at the top of the legacy
// dashboard. Everything else gets wrapped in ChartFrame.
export function WidgetRenderer({
  widget,
  rows,
  subtitle,
  wide,
}: WidgetRendererProps) {
  const chartType = widget.config.chart_type;

  if (chartType === "stat_card") {
    // Aggregate the rows: a stat-card widget should return a single row
    // with dim_a/dim_b nulls and a single value. If the SQL returned
    // multiple rows for some reason, sum them — the safer fallback.
    const total = rows.reduce((s, r) => s + (Number(r.value) || 0), 0);
    return (
      <StatCard
        label={widget.title}
        value={total.toLocaleString()}
        icon={<HashIcon />}
        hint={subtitle}
      />
    );
  }

  const frameIcon =
    chartType === "bar"
      ? BarChartBigIcon
      : chartType === "pie"
        ? ChartPieIcon
        : chartType === "line"
          ? TrendingUpIcon
          : GridIcon;

  return (
    <ChartFrame
      icon={frameIcon}
      title={widget.title}
      subtitle={subtitle}
      className={wide ? "p-5 lg:col-span-2" : undefined}
    >
      {renderChart(chartType, widget, rows)}
    </ChartFrame>
  );
}

function renderChart(
  chartType: OrgDashboardWidget["config"]["chart_type"],
  widget: OrgDashboardWidget,
  rows: WidgetExecuteRow[],
): React.ReactNode {
  switch (chartType) {
    case "bar": {
      // Time-bucketed bar → daily bar chart (matches the legacy
      // "New Leads — Daily" widget). Categorical bar → horizontal
      // bar list so long category names don't get squashed.
      const timeBucketed =
        widget.config.kind !== "sql" &&
        Boolean(widget.config.row_dimension?.bucket);
      const items = rows
        .filter((r) => r.dim_a !== null)
        .map((r) => ({
          date: r.dim_a as string,
          label: r.dim_a as string,
          value: Number(r.value) || 0,
        }));
      if (items.length === 0) {
        return <EmptyState />;
      }
      if (timeBucketed) {
        return (
          <DailyBarChart
            data={items.map((i) => ({ date: i.date, value: i.value }))}
            seriesLabel={widget.title}
          />
        );
      }
      const total = items.reduce((s, i) => s + i.value, 0);
      return (
        <HorizontalBarList
          items={items.map((i) => ({ label: i.label, value: i.value }))}
          total={total}
          totalLabel="Total"
        />
      );
    }
    case "pie": {
      const slices = rows
        .filter((r) => r.dim_a !== null && r.value > 0)
        .map((r) => ({ label: r.dim_a as string, value: Number(r.value) }));
      if (slices.length === 0) return <EmptyState />;
      return <PieChart data={slices} />;
    }
    case "line": {
      const points = rows
        .filter((r) => r.dim_a !== null)
        .map((r) => ({
          period: r.dim_a as string,
          value: Number(r.value) || 0,
        }));
      if (points.length === 0) return <EmptyState />;
      return <LineChart data={points} seriesLabel={widget.title} />;
    }
    case "pivot": {
      const cells = rows
        .filter((r) => r.dim_a !== null && r.dim_b !== null)
        .map((r) => ({
          row: r.dim_a as string,
          column: r.dim_b as string,
          value: Number(r.value) || 0,
        }));
      if (cells.length === 0) return <EmptyState />;
      return (
        <PivotTable
          data={cells}
          rowHeader={
            widget.config.kind !== "sql"
              ? (widget.config.row_dimension?.key ?? "Row")
              : "Row"
          }
          columnHeader={
            widget.config.kind !== "sql"
              ? (widget.config.column_dimension?.key ?? "Column")
              : "Column"
          }
        />
      );
    }
    case "stat_card":
      // Already handled at the top level. Unreachable but keeps the
      // switch exhaustive for the TS compiler.
      return null;
  }
}

function EmptyState() {
  return (
    <p className="rounded-md border border-dashed border-border/70 py-8 text-center text-xs text-muted-foreground">
      No data in the selected range.
    </p>
  );
}
