"use client";

import * as React from "react";

export interface PieSlice {
  label: string;
  value: number;
}

interface Props {
  data: PieSlice[];
  /** Optional override for the empty state label. */
  emptyLabel?: string;
}

// Lean SVG donut. No charting library — same aesthetic as the other
// custom charts in this folder. Up to 8 slices are drawn; anything
// beyond is folded into an "Other" wedge so the legend stays scannable.
//
// The wedges share a tactile-minimalism palette: foreground tones
// with descending opacity so the busier the chart, the calmer the
// colour. Hovering a slice highlights both wedge and legend row.

const MAX_SLICES = 8;
const SIZE = 220;
const THICKNESS = 40;
const RADIUS = SIZE / 2;
const INNER = RADIUS - THICKNESS;

export function PieChart({ data, emptyLabel = "No data" }: Props) {
  const slices = React.useMemo(() => collapse(data), [data]);
  const total = slices.reduce((s, x) => s + x.value, 0);
  const [activeIdx, setActiveIdx] = React.useState<number | null>(null);

  if (total === 0) {
    return (
      <div className="grid h-full place-items-center py-8 text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  // Build wedges via reduce so the running angle isn't a closure-captured
  // mutation — pattern preferred by react-hooks/immutability.
  const wedges = slices.reduce<
    Array<{ slice: PieSlice; idx: number; start: number; end: number }>
  >((acc, slice, idx) => {
    const angle = (slice.value / total) * Math.PI * 2;
    const start = acc.length === 0 ? -Math.PI / 2 : acc[acc.length - 1].end;
    const end = start + angle;
    acc.push({ slice, idx, start, end });
    return acc;
  }, []);

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        className="shrink-0"
        role="img"
        aria-label="Pie chart"
      >
        {wedges.map(({ slice, idx, start, end }) => {
          const path = arcPath(RADIUS, RADIUS, INNER, RADIUS - 4, start, end);
          const isActive = activeIdx === idx;
          return (
            <path
              key={slice.label}
              d={path}
              className="fill-foreground transition-opacity"
              style={{
                opacity:
                  activeIdx === null
                    ? 0.18 + (0.7 * (wedges.length - idx)) / wedges.length
                    : isActive
                      ? 0.92
                      : 0.12,
              }}
              onMouseEnter={() => setActiveIdx(idx)}
              onMouseLeave={() => setActiveIdx(null)}
              onFocus={() => setActiveIdx(idx)}
              onBlur={() => setActiveIdx(null)}
              tabIndex={0}
            >
              <title>{`${slice.label}: ${slice.value.toLocaleString()} (${pct(slice.value, total)})`}</title>
            </path>
          );
        })}
        <text
          x={RADIUS}
          y={RADIUS - 2}
          textAnchor="middle"
          className="fill-foreground text-lg font-semibold"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {total.toLocaleString()}
        </text>
        <text
          x={RADIUS}
          y={RADIUS + 16}
          textAnchor="middle"
          className="fill-muted-foreground text-[11px] uppercase tracking-wider"
        >
          Total
        </text>
      </svg>

      <ul className="flex w-full flex-col gap-1.5 text-sm">
        {wedges.map(({ slice, idx }) => {
          const isActive = activeIdx === idx;
          const share = pct(slice.value, total);
          return (
            <li
              key={slice.label}
              className="flex items-center gap-2"
              onMouseEnter={() => setActiveIdx(idx)}
              onMouseLeave={() => setActiveIdx(null)}
            >
              <span
                className="size-2.5 shrink-0 rounded-sm bg-foreground transition-opacity"
                style={{
                  opacity:
                    activeIdx === null
                      ? 0.18 + (0.7 * (wedges.length - idx)) / wedges.length
                      : isActive
                        ? 0.92
                        : 0.12,
                }}
                aria-hidden
              />
              <span className="flex-1 truncate text-sm">{slice.label}</span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {slice.value.toLocaleString()}
              </span>
              <span className="w-10 text-right font-mono text-xs tabular-nums text-muted-foreground">
                {share}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function collapse(data: PieSlice[]): PieSlice[] {
  const cleaned = data
    .filter((d) => Number.isFinite(d.value) && d.value > 0)
    .sort((a, b) => b.value - a.value);
  if (cleaned.length <= MAX_SLICES) return cleaned;
  const head = cleaned.slice(0, MAX_SLICES - 1);
  const tailSum = cleaned
    .slice(MAX_SLICES - 1)
    .reduce((s, x) => s + x.value, 0);
  if (tailSum === 0) return head;
  head.push({ label: "Other", value: tailSum });
  return head;
}

// Annular wedge between innerR and outerR from startAngle to endAngle
// (radians, 0 at +X, increasing clockwise in SVG).
function arcPath(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number,
): string {
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  const x1 = cx + Math.cos(startAngle) * outerR;
  const y1 = cy + Math.sin(startAngle) * outerR;
  const x2 = cx + Math.cos(endAngle) * outerR;
  const y2 = cy + Math.sin(endAngle) * outerR;
  const x3 = cx + Math.cos(endAngle) * innerR;
  const y3 = cy + Math.sin(endAngle) * innerR;
  const x4 = cx + Math.cos(startAngle) * innerR;
  const y4 = cy + Math.sin(startAngle) * innerR;
  return [
    `M ${x1} ${y1}`,
    `A ${outerR} ${outerR} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${innerR} ${innerR} 0 ${large} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}

function pct(v: number, total: number): string {
  if (total === 0) return "0%";
  return `${((v / total) * 100).toFixed(1)}%`;
}
