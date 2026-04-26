import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  trend?: {
    delta: number;
    suffix?: string;
    period?: string;
  };
  hint?: string;
}

export function StatCard({
  label,
  value,
  icon,
  trend,
  hint,
}: StatCardProps) {
  return (
    <Card className="gap-3 p-5">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {icon ? (
          <span className="inline-flex size-4 items-center justify-center text-muted-foreground [&_svg]:size-3.5">
            {icon}
          </span>
        ) : null}
        <span>{label}</span>
      </div>
      <div className="font-heading text-3xl font-semibold leading-none tracking-tight">
        {value}
      </div>
      {trend ? (
        <TrendRow trend={trend} />
      ) : hint ? (
        <div className="text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </Card>
  );
}

function TrendRow({ trend }: { trend: NonNullable<StatCardProps["trend"]> }) {
  const { delta, suffix = "", period = "vs. yesterday" } = trend;
  const zero = delta === 0;
  const positive = delta > 0;
  const sign = positive ? "+" : "";
  const display = `${sign}${delta}${suffix}`;

  return (
    <div className="flex items-center gap-1.5 text-xs font-medium">
      <span
        className={cn(
          "inline-flex items-center gap-0.5",
          zero
            ? "text-muted-foreground"
            : positive
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-destructive",
        )}
      >
        {zero ? null : positive ? (
          <ArrowUpIcon className="size-3" />
        ) : (
          <ArrowDownIcon className="size-3" />
        )}
        {display}
      </span>
      <span className="text-muted-foreground">{period}</span>
    </div>
  );
}
