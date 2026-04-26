import type { CallStatus } from "@/types/call";

const LABELS: Record<CallStatus, string> = {
  initiated: "Dialling",
  ringing: "Ringing",
  in_progress: "Live",
  completed: "Completed",
  failed: "Failed",
  no_answer: "No answer",
  busy: "Busy",
  canceled: "Canceled",
};

const SWATCH: Record<CallStatus, string> = {
  initiated: "bg-muted-foreground/60",
  ringing: "bg-sky-300",
  in_progress: "bg-sky-500",
  completed: "bg-emerald-500",
  failed: "bg-destructive",
  no_answer: "bg-amber-500",
  busy: "bg-amber-400",
  canceled: "bg-muted-foreground/50",
};

interface CallOutcomesProps {
  outcomes: Array<{ status: CallStatus; count: number }>;
  total: number;
}

export function CallOutcomes({ outcomes, total }: CallOutcomesProps) {
  if (total === 0 || outcomes.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border/70 py-8 text-center text-xs text-muted-foreground">
        No calls in this window.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {outcomes.map((o) => {
          const pct = (o.count / total) * 100;
          return (
            <div
              key={o.status}
              className={SWATCH[o.status]}
              style={{ width: `${pct}%` }}
              title={`${LABELS[o.status]} — ${o.count}`}
            />
          );
        })}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        {outcomes.map((o) => {
          const pct = ((o.count / total) * 100).toFixed(1);
          return (
            <li
              key={o.status}
              className="flex items-center justify-between gap-2"
            >
              <span className="inline-flex items-center gap-1.5">
                <span className={`inline-block size-2.5 rounded-sm ${SWATCH[o.status]}`} />
                <span className="text-muted-foreground">
                  {LABELS[o.status]}
                </span>
              </span>
              <span className="font-medium tabular-nums">
                {o.count}
                <span className="ml-1 text-muted-foreground">({pct}%)</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
