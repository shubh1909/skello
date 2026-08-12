import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";

import { Sparkline } from "@/components/app/analytics/sparkline";
import { cn } from "@/lib/utils";

import type { SparkPoint } from "@/lib/analytics/dashboard";

export interface KpiCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  /** The trend line. Omit when there is no series to show. */
  spark?: readonly SparkPoint[];
  /** Any CSS colour for the line; defaults to the chart-1 token. */
  sparkColor?: string;
  delta?: {
    /** Signed change. Rendered with its own sign and suffix. */
    value: number;
    suffix?: string;
    period?: string;
    /**
     * Set false where a rise is bad. Nothing on this dashboard is inverted
     * today, but "no answer rate" would be.
     */
    higherIsBetter?: boolean;
  };
  /** Shown in place of the delta when there's no comparison to make. */
  hint?: string;
}

/**
 * One headline number: label + icon chip, the value, and either a trend line or
 * a delta beneath it.
 *
 * The delta is the point. A sparkline normalises to its own min and max, so a
 * metric that moved 1% and one that tripled draw the same shape — the line
 * shows *rhythm*, the delta shows *size*. Neither is sufficient alone, which is
 * why the reference design's sparkline-only card was hard to read.
 */
export function KpiCard({
  label,
  value,
  icon,
  spark,
  sparkColor,
  delta,
  hint,
}: KpiCardProps) {
  return (
    <div className="rounded-lg border border-border/70 bg-card px-[17px] py-[15px]">
      <div className="flex items-center justify-between gap-2 text-[12.5px] font-medium text-muted-foreground">
        <span className="truncate">{label}</span>
        <span className="grid size-[30px] flex-none place-items-center rounded-[7px] bg-muted text-muted-foreground [&_svg]:size-[15px]">
          {icon}
        </span>
      </div>

      <div className="mt-[9px] font-heading text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums">
        {value}
      </div>

      {spark && spark.length > 0 ? (
        <div className="mt-[7px]">
          <Sparkline data={spark} color={sparkColor} />
        </div>
      ) : null}

      {delta ? (
        <DeltaRow {...delta} />
      ) : hint ? (
        <p className="mt-[7px] text-[11.5px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function DeltaRow({
  value,
  suffix = "",
  period = "vs. previous period",
  higherIsBetter = true,
}: NonNullable<KpiCardProps["delta"]>) {
  const flat = value === 0;
  const up = value > 0;
  const good = up === higherIsBetter;

  return (
    <div className="mt-[7px] flex items-center gap-1.5 text-[11.5px]">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 font-medium",
          flat
            ? "text-muted-foreground"
            : good
              ? "text-success"
              : "text-destructive",
        )}
      >
        {flat ? null : up ? (
          <ArrowUpIcon className="size-3" />
        ) : (
          <ArrowDownIcon className="size-3" />
        )}
        {up ? "+" : ""}
        {value}
        {suffix}
      </span>
      <span className="truncate text-muted-foreground">{period}</span>
    </div>
  );
}
