"use client";

import * as React from "react";

export interface LinePoint {
  // Bucketed date string (YYYY-MM-DD or YYYY-MM-01 / week-start), as
  // emitted by the SQL `to_char(date_trunc('day', col), 'YYYY-MM-DD')`
  // expression. The chart treats them as ordered labels — no parsing
  // is required for plotting, but we display a short month-day label.
  period: string;
  value: number;
}

interface Props {
  data: LinePoint[];
  seriesLabel?: string;
  emptyLabel?: string;
}

// SVG line chart. Matches the visual weight of DailyBarChart in the
// same folder so a mixed dashboard reads as one set. No d3 / no
// charting lib — single polyline + circle markers + a fill area.

const PADDING = { top: 18, right: 12, bottom: 26, left: 36 };

export function LineChart({
  data,
  seriesLabel = "Value",
  emptyLabel = "No data",
}: Props) {
  const cleaned = React.useMemo(
    () => data.filter((d) => Number.isFinite(d.value)),
    [data],
  );
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null);
  const [box, setBox] = React.useState({ w: 480, h: 220 });
  const wrapRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBox({ w: Math.max(280, r.width), h: 220 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (cleaned.length === 0) {
    return (
      <div
        className="grid h-full place-items-center py-8 text-sm text-muted-foreground"
        ref={wrapRef}
      >
        {emptyLabel}
      </div>
    );
  }

  const maxValue = Math.max(...cleaned.map((d) => d.value), 1);
  const minValue = Math.min(...cleaned.map((d) => d.value), 0);
  const range = Math.max(1, maxValue - minValue);
  const plotW = box.w - PADDING.left - PADDING.right;
  const plotH = box.h - PADDING.top - PADDING.bottom;

  const xFor = (i: number): number => {
    if (cleaned.length === 1) return PADDING.left + plotW / 2;
    return PADDING.left + (i / (cleaned.length - 1)) * plotW;
  };
  const yFor = (v: number): number =>
    PADDING.top + plotH - ((v - minValue) / range) * plotH;

  // Line + area path
  const linePath = cleaned
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(d.value)}`)
    .join(" ");
  const areaPath =
    `M ${xFor(0)} ${yFor(minValue)} ` +
    cleaned.map((d, i) => `L ${xFor(i)} ${yFor(d.value)}`).join(" ") +
    ` L ${xFor(cleaned.length - 1)} ${yFor(minValue)} Z`;

  const gridLines = niceTicks(minValue, maxValue, 4);

  return (
    <div ref={wrapRef} className="w-full">
      <svg
        viewBox={`0 0 ${box.w} ${box.h}`}
        width="100%"
        height={box.h}
        role="img"
        aria-label={`${seriesLabel} over time`}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Y-axis tick lines + labels */}
        {gridLines.map((g) => (
          <g key={g}>
            <line
              x1={PADDING.left}
              x2={box.w - PADDING.right}
              y1={yFor(g)}
              y2={yFor(g)}
              className="stroke-border/60"
              strokeDasharray="2 3"
            />
            <text
              x={PADDING.left - 6}
              y={yFor(g) + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[10px]"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {compactNumber(g)}
            </text>
          </g>
        ))}

        {/* Filled area */}
        <path d={areaPath} className="fill-foreground/10" />

        {/* Line */}
        <path
          d={linePath}
          className="stroke-foreground"
          strokeWidth={1.5}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Point markers + hover hit areas */}
        {cleaned.map((d, i) => {
          const isHover = hoverIdx === i;
          return (
            <g key={d.period}>
              <circle
                cx={xFor(i)}
                cy={yFor(d.value)}
                r={isHover ? 4 : 2.5}
                className="fill-background stroke-foreground"
                strokeWidth={1.5}
              />
              <rect
                x={xFor(i) - 12}
                y={PADDING.top}
                width={24}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
              />
            </g>
          );
        })}

        {/* Hover label */}
        {hoverIdx !== null ? (
          <g pointerEvents="none">
            <line
              x1={xFor(hoverIdx)}
              x2={xFor(hoverIdx)}
              y1={PADDING.top}
              y2={PADDING.top + plotH}
              className="stroke-foreground/40"
              strokeDasharray="2 3"
            />
            <text
              x={xFor(hoverIdx)}
              y={PADDING.top - 4}
              textAnchor="middle"
              className="fill-foreground text-[11px] font-medium"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {cleaned[hoverIdx].value.toLocaleString()}
            </text>
          </g>
        ) : null}

        {/* X-axis labels — first, last, and every Nth */}
        {cleaned.map((d, i) => {
          const showLabel =
            i === 0 ||
            i === cleaned.length - 1 ||
            i % Math.ceil(cleaned.length / 6) === 0;
          if (!showLabel) return null;
          return (
            <text
              key={`x-${d.period}`}
              x={xFor(i)}
              y={box.h - 8}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {shortLabel(d.period)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function niceTicks(min: number, max: number, count: number): number[] {
  if (min === max) return [min];
  const range = max - min;
  const step = niceStep(range / count);
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + 1e-9; v += step) ticks.push(v);
  return ticks;
}

function niceStep(rough: number): number {
  if (rough <= 0) return 1;
  const exp = Math.floor(Math.log10(rough));
  const base = Math.pow(10, exp);
  const r = rough / base;
  if (r < 1.5) return base;
  if (r < 3) return 2 * base;
  if (r < 7) return 5 * base;
  return 10 * base;
}

function compactNumber(n: number): string {
  if (!Number.isFinite(n)) return "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(1);
}

// Render YYYY-MM-DD as "MMM dd"; if monthly bucket (YYYY-MM-01) → "MMM ''YY".
function shortLabel(period: string): string {
  const date = new Date(period);
  if (Number.isNaN(date.getTime())) return period;
  if (period.endsWith("-01")) {
    return new Intl.DateTimeFormat("en", {
      month: "short",
      year: "2-digit",
    }).format(date);
  }
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(date);
}
