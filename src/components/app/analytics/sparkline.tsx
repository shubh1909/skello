import { cn } from "@/lib/utils";

import type { SparkPoint } from "@/lib/analytics/dashboard";

export interface SparklineProps {
  /** The series. `null` is a gap — no data that day, not a value of zero. */
  data: readonly SparkPoint[];
  /** Any CSS colour; defaults to the chart-1 token. */
  color?: string;
  className?: string;
  width?: number;
  height?: number;
}

const STROKE = 2;

/**
 * A single-series trend line, pure SVG.
 *
 * ## Three things the reference implementation got wrong
 *
 * **A flat series drew along the bottom.** Normalising by `(max - min) || 1`
 * makes every point `v - min = 0`, which lands on the baseline — so "steady"
 * rendered as "collapsed", the most alarming shape on the card. A series with
 * no spread is now drawn through the vertical middle.
 *
 * **A single point produced `NaN`.** The x-step divides by `length - 1`, which
 * is zero for one point. One point is drawn as a dot instead.
 *
 * **Gaps were indistinguishable from zeros.** A day with no calls has no
 * connect rate; plotting it as 0% draws a cliff that reads as a performance
 * collapse when in fact nobody dialled. Nulls break the line into separate
 * segments, so the gap is visible as a gap.
 *
 * Decorative by definition: the number it accompanies is the fact, the line is
 * the shape. Hidden from assistive tech rather than given a label nobody can
 * act on.
 */
export function Sparkline({
  data,
  color = "var(--chart-1)",
  className,
  width = 104,
  height = 26,
}: SparklineProps) {
  const points = data.map((v, i) => ({ i, v }));
  const values = points
    .map((p) => p.v)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  if (values.length === 0) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const spread = max - min;
  const top = STROKE / 2 + 1;
  const usable = height - top * 2;

  // With no spread there is no meaningful position, so sit on the midline.
  const y = (v: number) =>
    spread === 0 ? height / 2 : top + usable - ((v - min) / spread) * usable;
  // A one-point series has no x-step; place it centrally.
  const x = (i: number) =>
    data.length <= 1 ? width / 2 : (i / (data.length - 1)) * width;

  if (values.length === 1) {
    const only = points.find((p) => typeof p.v === "number")!;
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={cn("overflow-visible", className)}
        aria-hidden
      >
        <circle cx={x(only.i)} cy={height / 2} r={STROKE} fill={color} />
      </svg>
    );
  }

  // Split into runs of consecutive non-null points; each run is its own line.
  const runs: Array<Array<{ i: number; v: number }>> = [];
  let run: Array<{ i: number; v: number }> = [];
  for (const p of points) {
    if (typeof p.v === "number" && Number.isFinite(p.v)) {
      run.push({ i: p.i, v: p.v });
    } else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 0) runs.push(run);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      aria-hidden
    >
      {runs.map((r, idx) =>
        // A lone point between two gaps has no line to draw — mark it, or it
        // vanishes and the series looks emptier than it is.
        r.length === 1 ? (
          <circle
            key={idx}
            cx={x(r[0].i)}
            cy={y(r[0].v)}
            r={STROKE / 1.4}
            fill={color}
            opacity={0.85}
          />
        ) : (
          <polyline
            key={idx}
            points={r.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.85}
          />
        ),
      )}
    </svg>
  );
}
