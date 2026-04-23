import { ArrowDownRightIcon, ArrowUpRightIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  trend?: { delta: number; suffix?: string };
}

export function StatCard({ label, value, hint, trend }: StatCardProps) {
  const positive = (trend?.delta ?? 0) >= 0;
  return (
    <Card className="gap-2 p-5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex items-baseline gap-2">
        <div className="font-heading text-2xl font-semibold tracking-tight">
          {value}
        </div>
        {trend ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-medium",
              positive ? "text-emerald-600" : "text-destructive",
            )}
          >
            {positive ? (
              <ArrowUpRightIcon className="size-3" />
            ) : (
              <ArrowDownRightIcon className="size-3" />
            )}
            {Math.abs(trend.delta)}
            {trend.suffix ?? "%"}
          </span>
        ) : null}
      </div>
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </Card>
  );
}
