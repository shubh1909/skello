import type { LucideIcon } from "lucide-react";

import { Card } from "@/components/ui/card";

interface ChartFrameProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function ChartFrame({
  icon: Icon,
  title,
  subtitle,
  action,
  children,
  className,
}: ChartFrameProps) {
  return (
    <Card className={className ?? "p-5"}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Icon className="size-4 text-foreground" />
            <h3 className="font-heading text-sm font-semibold">{title}</h3>
          </div>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </Card>
  );
}
