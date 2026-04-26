import { cn } from "@/lib/utils";

interface DailyBarChartProps {
  data: Array<{ date: string; value: number }>;
  seriesLabel: string;
  emptyLabel?: string;
}

export function DailyBarChart({
  data,
  seriesLabel,
  emptyLabel = "No activity in this window.",
}: DailyBarChartProps) {
  const maxValue = Math.max(...data.map((d) => d.value), 0);
  const yMax = niceMax(maxValue);
  const allZero = maxValue === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
        <span className="inline-block size-2.5 rounded-sm bg-primary" />
        <span>{seriesLabel}</span>
      </div>

      <div className="relative h-56">
        <Gridlines yMax={yMax} />
        <div className="absolute inset-0 flex items-end gap-1.5 pl-10 pr-1 pb-6">
          {data.map((d) => {
            const pct = allZero ? 0 : (d.value / yMax) * 100;
            return (
              <div
                key={d.date}
                className="group relative flex h-full flex-1 flex-col justify-end"
                title={`${formatLabel(d.date)}: ${d.value} ${seriesLabel.toLowerCase()}`}
              >
                <div
                  className={cn(
                    "w-full rounded-t-sm bg-primary transition-opacity",
                    pct === 0 && "opacity-10",
                  )}
                  style={{ height: `${pct}%` }}
                />
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

export function formatLabel(isoDate: string): string {
  // isoDate is YYYY-MM-DD. Parse as UTC to avoid TZ drift on the server.
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function niceMax(n: number): number {
  if (n <= 1) return Math.max(n, 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(n)));
  const normalized = n / magnitude;
  let factor: number;
  if (normalized <= 1) factor = 1;
  else if (normalized <= 2) factor = 2;
  else if (normalized <= 5) factor = 5;
  else factor = 10;
  return factor * magnitude;
}
