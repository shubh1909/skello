interface IntentDonutProps {
  /**
   * Leads a call extraction classified — NOT every lead. Intent has exactly
   * one source in this product (`calls.lead_intent_extracted`), so a cart
   * nobody rang has no temperature and belongs in none of these three.
   */
  totals: { hot: number; warm: number; cold: number };
  emptyLabel?: string;
}

/**
 * Lead temperature is an ordered scale, so it reads off the semantic tokens
 * rather than --chart-*. The reference design has this inverted (hot green,
 * cold red); we keep the app's own convention — hot means "act now", which is
 * what destructive already signals everywhere else in this product. Two colour
 * languages for one concept is worse than either one of them.
 */
const SEGMENTS = [
  { key: "hot", label: "Hot", fill: "var(--destructive)" },
  { key: "warm", label: "Warm", fill: "var(--warning)" },
  { key: "cold", label: "Cold", fill: "var(--info)" },
] as const;

export function IntentDonut({
  totals,
  emptyLabel = "No leads in this window.",
}: IntentDonutProps) {
  const total = totals.hot + totals.warm + totals.cold;

  // Cumulative stops, walked once so rounding can't leave a seam: each segment
  // starts exactly where the last one ended, and the final one is pinned to
  // 100%. Computing each stop independently from a rounded percentage leaves
  // hairline gaps in the ring.
  const segments: Array<
    (typeof SEGMENTS)[number] & {
      count: number;
      share: number;
      from: number;
      to: number;
    }
  > = [];
  for (let i = 0; i < SEGMENTS.length; i++) {
    const s = SEGMENTS[i];
    const count = totals[s.key];
    const share = total === 0 ? 0 : (count / total) * 100;
    const from = i === 0 ? 0 : segments[i - 1].to;
    // Pin the last stop to 100 so accumulated rounding can't leave a sliver of
    // background showing at the end of the ring.
    const to = i === SEGMENTS.length - 1 ? 100 : from + share;
    segments.push({ ...s, count, share, from, to });
  }

  const gradient =
    total === 0
      ? "var(--muted)"
      : segments
          .map((s) => `${s.fill} ${s.from}% ${s.to}%`)
          .join(", ");

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-2 sm:flex-row sm:gap-[26px]">
      <div
        className="relative size-32 flex-none rounded-full"
        style={{ background: `conic-gradient(${gradient})` }}
        role="img"
        aria-label={
          total === 0
            ? emptyLabel
            : segments
                .map((s) => `${s.label} ${s.count}, ${Math.round(s.share)}%`)
                .join("; ")
        }
      >
        <div className="absolute inset-[26px] grid place-items-center rounded-full bg-card text-center">
          <div>
            <div className="font-heading text-[17px] font-semibold leading-none tabular-nums">
              {total.toLocaleString()}
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {total === 1 ? "lead" : "leads"}
            </div>
          </div>
        </div>
      </div>

      {/* An empty donut plus three dashes reads as "broken" rather than
          "nothing yet". When there is nothing to split, say why instead of
          rendering a legend of zeroes. */}
      {total === 0 ? (
        <p className="max-w-47.5 text-[12.5px] text-muted-foreground">
          {emptyLabel}
        </p>
      ) : (
        /* Counts AND percentages. The reference puts a count in the middle and
           percentages in the legend, so the two halves of the chart are in
           different units and can't be read against each other. */
        <dl className="w-full max-w-47.5 sm:w-auto">
          {segments.map((s) => (
            <div
              key={s.key}
              className="flex items-center gap-2 py-1.25 text-[12.5px]"
            >
              <span
                aria-hidden
                className="inline-block size-2.25 flex-none rounded-[3px]"
                style={{ background: s.fill }}
              />
              <dt className="min-w-11 flex-1">{s.label}</dt>
              <dd className="flex items-baseline gap-1.5 tabular-nums">
                <span className="font-semibold">
                  {s.count.toLocaleString()}
                </span>
                <span className="w-9 text-right text-muted-foreground">
                  {Math.round(s.share)}%
                </span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
