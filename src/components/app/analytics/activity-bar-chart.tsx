import { formatLabel } from "@/components/app/analytics/daily-bar-chart";
import { cn } from "@/lib/utils";

interface ActivityBarChartProps {
  data: Array<{ date: string; count: number }>;
  /** Singular unit name, e.g. "call" — used in the hover title and empty copy. */
  unit: string;
  emptyLabel?: string;
}

// Tallest bar, in px. The container is a little taller to leave room for the
// value label that sits above the last bar.
const BAR_MAX = 96;

/**
 * The dashboard's hero bar chart: one bar per day, no axis, no gridlines.
 *
 * Deliberately separate from `DailyBarChart`, which keeps its y-axis and
 * gridlines because the custom-widget renderer shows arbitrary series where the
 * absolute scale matters. Here the series is always "activity per day over a
 * known window", the shape is the message, and the axis is furniture.
 *
 * The reference design labels every bar at 9.5px. Across 14 bars that is a wall
 * of unreadable digits, so only the most recent bar — the one people look for —
 * is labelled outright; the rest reveal on hover.
 */
export function ActivityBarChart({
  data,
  unit,
  emptyLabel,
}: ActivityBarChartProps) {
  // `Math.max()` of an empty list is -Infinity, which makes every height NaN
  // and renders a blank panel. That is precisely what a brand-new org sees on
  // day one, so guard rather than assume a populated series.
  const max = data.length > 0 ? Math.max(...data.map((d) => d.count)) : 0;
  const allZero = max === 0;

  if (data.length === 0 || allZero) {
    return (
      <div className="flex h-[132px] items-center justify-center rounded-md border border-dashed border-border/70 text-sm text-muted-foreground">
        {emptyLabel ?? `No ${unit}s in this window.`}
      </div>
    );
  }

  const lastIndex = data.length - 1;

  return (
    <div className="flex h-[132px] items-end gap-1.5">
      {data.map((d, i) => {
        const height = Math.round((d.count / max) * BAR_MAX);
        const latest = i === lastIndex;
        return (
          <div
            key={d.date}
            className="group flex flex-1 flex-col justify-end text-center"
            title={`${formatLabel(d.date)}: ${d.count} ${d.count === 1 ? unit : `${unit}s`}`}
          >
            <div
              className={cn(
                "mb-[3px] text-[9.5px] tabular-nums text-muted-foreground transition-opacity",
                // The latest value is always readable; the rest on hover, so
                // the row isn't a wall of 9.5px digits.
                latest ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
            >
              {d.count}
            </div>
            <div
              className={cn(
                "w-full rounded-t-[5px] border transition-colors",
                latest
                  ? "border-primary bg-primary"
                  : "border-highlight-border bg-highlight group-hover:border-primary/40",
              )}
              // A zero-count day still needs a visible footing, or the row
              // reads as "chart ends here" rather than "nothing that day".
              style={{ height: `${Math.max(height, 2)}px` }}
            />
          </div>
        );
      })}
    </div>
  );
}
