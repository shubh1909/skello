import { cn } from "@/lib/utils";
import type { Campaign } from "@/types/campaign";

/**
 * How far a campaign has got, as four numbers and one bar.
 *
 * Split out because the campaigns list and the campaign detail header now show
 * the same thing, and a run's progress reported two different ways on two
 * screens is exactly the kind of drift `CAMPAIGN_STATUS_LABEL` was extracted to
 * stop.
 */
export interface CampaignProgress {
  succeeded: number;
  failed: number;
  inFlight: number;
  /** Not attempted yet — the bar's empty remainder. */
  remaining: number;
  finished: number;
  total: number;
  donePct: number;
  succeededPct: number;
  failedPct: number;
  inFlightPct: number;
}

export function campaignProgress(c: Campaign): CampaignProgress {
  const total = Math.max(1, c.total_contacts);
  const finished = c.succeeded_count + c.failed_count;
  return {
    succeeded: c.succeeded_count,
    failed: c.failed_count,
    inFlight: c.in_flight_count,
    remaining: Math.max(0, c.total_contacts - finished - c.in_flight_count),
    finished,
    total: c.total_contacts,
    donePct: Math.min(100, Math.round((finished / total) * 100)),
    succeededPct: Math.round((c.succeeded_count / total) * 100),
    failedPct: Math.round((c.failed_count / total) * 100),
    inFlightPct: Math.round((c.in_flight_count / total) * 100),
  };
}

/**
 * The segmented bar.
 *
 * `title` rather than a real tooltip on each segment: a table page renders 50 of
 * these, so three `Tooltip` roots per row would be 150 floating-UI instances
 * mounted to explain a colour the legend above already names.
 */
export function CampaignProgressBar({
  progress,
  className,
}: {
  progress: CampaignProgress;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "h-2 w-full overflow-hidden rounded-full bg-muted",
        className,
      )}
    >
      <div className="flex h-full">
        <span
          className="bg-success"
          style={{ width: `${progress.succeededPct}%` }}
          title={`${progress.succeeded} connected`}
        />
        <span
          className="bg-destructive"
          style={{ width: `${progress.failedPct}%` }}
          title={`${progress.failed} failed`}
        />
        {/* Pulsing is the one animation here that carries meaning: it says
            "these are on the phone right now", which a static segment can't. */}
        <span
          className="animate-pulse bg-info"
          style={{ width: `${progress.inFlightPct}%` }}
          title={`${progress.inFlight} dialing`}
        />
      </div>
    </div>
  );
}

const LEGEND = [
  { key: "succeeded", label: "Connected", dot: "bg-success" },
  { key: "failed", label: "Failed", dot: "bg-destructive" },
  { key: "inFlight", label: "Dialing", dot: "bg-info" },
  { key: "remaining", label: "To go", dot: "bg-muted-foreground/40" },
] as const;

/**
 * The colour key for the progress bars.
 *
 * Rendered **once per table**, not once per row. The old table repeated an
 * identical four-item legend inside all 50 progress cells — the same words, the
 * same colours, fifty times — which is what pushed that column to a 220px
 * minimum and the table into permanent horizontal scroll.
 */
export function CampaignProgressLegend({ className }: { className?: string }) {
  return (
    <ul
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground",
        className,
      )}
    >
      {LEGEND.map((item) => (
        <li key={item.key} className="inline-flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", item.dot)} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
