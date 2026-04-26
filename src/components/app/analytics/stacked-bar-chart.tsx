import { formatLabel, niceMax } from "./daily-bar-chart";

interface StackedBarChartProps {
  data: Array<{ date: string; hot: number; warm: number; cold: number }>;
  totals: { hot: number; warm: number; cold: number };
  emptyLabel?: string;
}

const SERIES = [
  { key: "hot", label: "Hot", className: "bg-red-500/90" },
  { key: "warm", label: "Warm", className: "bg-amber-500/90" },
  { key: "cold", label: "Cold", className: "bg-sky-400/80" },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];

export function StackedBarChart({
  data,
  totals,
  emptyLabel = "No leads in this window.",
}: StackedBarChartProps) {
  const maxStack = Math.max(
    ...data.map((d) => d.hot + d.warm + d.cold),
    0,
  );
  const yMax = niceMax(maxStack);
  const allZero = maxStack === 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs">
        {SERIES.map((s) => (
          <div key={s.key} className="inline-flex items-center gap-1.5">
            <span className={`inline-block size-2.5 rounded-sm ${s.className}`} />
            <span className="text-muted-foreground">
              {s.label}{" "}
              <span className="font-medium text-foreground">
                {totals[s.key as SeriesKey]}
              </span>
            </span>
          </div>
        ))}
      </div>

      <div className="relative h-56">
        <Gridlines yMax={yMax} />
        <div className="absolute inset-0 flex items-end gap-1.5 pl-10 pr-1 pb-6">
          {data.map((d) => {
            const total = d.hot + d.warm + d.cold;
            const stackPct = allZero ? 0 : (total / yMax) * 100;
            return (
              <div
                key={d.date}
                className="relative flex h-full flex-1 flex-col justify-end"
                title={`${formatLabel(d.date)} · hot ${d.hot} · warm ${d.warm} · cold ${d.cold}`}
              >
                <div
                  className="flex w-full flex-col overflow-hidden rounded-t-sm"
                  style={{ height: `${stackPct}%` }}
                >
                  {SERIES.map((s) => {
                    const v = d[s.key as SeriesKey];
                    if (total === 0 || v === 0) return null;
                    const pct = (v / total) * 100;
                    return (
                      <div
                        key={s.key}
                        className={s.className}
                        style={{ height: `${pct}%` }}
                      />
                    );
                  })}
                </div>
                <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground">
                  {formatLabel(d.date)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {allZero ? (
        <p className="text-center text-xs text-muted-foreground">{emptyLabel}</p>
      ) : null}
    </div>
  );
}

function Gridlines({ yMax }: { yMax: number }) {
  const stops = [0, 0.5, 1] as const;
  return (
    <div className="pointer-events-none absolute inset-0 pb-6">
      {stops.map((stop) => {
        const value = Math.round(yMax * stop);
        return (
          <div
            key={stop}
            className="absolute left-0 right-0 flex items-center"
            style={{ bottom: `${stop * 100}%` }}
          >
            <span className="w-10 pr-2 text-right text-[10px] text-muted-foreground">
              {value}
            </span>
            <div className="h-px flex-1 border-t border-dashed border-border/60" />
          </div>
        );
      })}
    </div>
  );
}
