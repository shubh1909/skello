/**
 * The categorical chart palette.
 *
 * For series with **no inherent meaning** — a breakdown by agent, by city, by
 * product. Status charts must not use these: in `call-outcomes.tsx` a failed
 * call is `destructive` and a completed one is `success` because those words
 * carry the meaning, and swapping them for arbitrary hues would throw that
 * away.
 *
 * Classes are listed in full rather than built as `bg-chart-${n}`. Tailwind
 * scans source *text*, so an interpolated class name produces no CSS at all —
 * the chart would simply render transparent.
 */

export interface ChartSeriesTone {
  /** Swatches, legend dots, div-based bars. */
  bg: string;
  /** SVG wedges, areas. */
  fill: string;
  /** SVG lines, marker outlines. */
  stroke: string;
}

export const CHART_SERIES: readonly ChartSeriesTone[] = [
  { bg: "bg-chart-1", fill: "fill-chart-1", stroke: "stroke-chart-1" },
  { bg: "bg-chart-2", fill: "fill-chart-2", stroke: "stroke-chart-2" },
  { bg: "bg-chart-3", fill: "fill-chart-3", stroke: "stroke-chart-3" },
  { bg: "bg-chart-4", fill: "fill-chart-4", stroke: "stroke-chart-4" },
  { bg: "bg-chart-5", fill: "fill-chart-5", stroke: "stroke-chart-5" },
  { bg: "bg-chart-6", fill: "fill-chart-6", stroke: "stroke-chart-6" },
  { bg: "bg-chart-7", fill: "fill-chart-7", stroke: "stroke-chart-7" },
  { bg: "bg-chart-8", fill: "fill-chart-8", stroke: "stroke-chart-8" },
];

/** Wraps, so a caller is never responsible for bounding its own index. */
export function chartSeries(index: number): ChartSeriesTone {
  return CHART_SERIES[Math.abs(index) % CHART_SERIES.length];
}
