import { Badge } from "@/components/ui/badge";

// Event-based colours for a recovery call's lifecycle status. Green = live call,
// blue = connected/finished, red = failed, amber/orange = dialing / not reached.
const CALL_STATUS_META: Record<string, { label: string; className: string }> = {
  initiated: {
    label: "Queued",
    className: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
  },
  ringing: {
    label: "Ringing",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  },
  in_progress: {
    label: "In call",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  completed: {
    label: "Connected",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  },
  failed: {
    label: "Failed",
    className: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  },
  no_answer: {
    label: "No answer",
    className:
      "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  },
  busy: {
    label: "Busy",
    className:
      "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  },
  canceled: { label: "Canceled", className: "bg-muted text-muted-foreground" },
};

export function CallStatusBadge({ status }: { status: string }) {
  const meta = CALL_STATUS_META[status];
  if (!meta) return <Badge variant="secondary">{status}</Badge>;
  return <Badge className={meta.className}>{meta.label}</Badge>;
}

// The cart's real-world outcome, independent of the dial pipeline status.
export function CartOutcomeBadge({
  convertedAt,
  attributed,
}: {
  convertedAt: string | null;
  attributed?: boolean;
}) {
  if (!convertedAt) {
    return <Badge className="bg-muted text-muted-foreground">Abandoned</Badge>;
  }
  if (attributed) {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
        Recovered · by us
      </Badge>
    );
  }
  return (
    <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300">
      Recovered · organic
    </Badge>
  );
}
