import { SectionLabel } from "@/components/app/section-label";
import { cn } from "@/lib/utils";

/**
 * A vertical rail of timestamped events.
 *
 * This exists to replace a grid of five timestamps where EVERY ONE carried an
 * `(i)` tooltip, because "Checkout started" / "Received by us" / "Marked
 * recovered" are indistinguishable as bare labels. Five tooltips is not a
 * tooltip problem — it's the layout admitting the labels can't do their job.
 *
 * On a rail, order and elapsed time are the explanation:
 *
 *   Abandoned at checkout    14:02
 *   Webhook received         +4s
 *   WhatsApp sent            +2h
 *   Order matched            +1d 3h
 *
 * `hint` survives for the genuinely non-obvious (how a conversion was matched),
 * not as a crutch for a vague label.
 *
 * Deltas are computed between two stored timestamps — never against `Date.now()`
 * — so this renders identically on the server and the client.
 */

export interface TimelineEvent {
  label: string;
  /** ISO. Events with no timestamp are dropped. */
  at: string | null | undefined;
  /** Absolute time, already formatted by the caller (locale/timezone is theirs). */
  display: string;
  hint?: string;
  /** Scheduled, not happened. Renders hollow. */
  upcoming?: boolean;
}

function elapsed(fromIso: string, toIso: string): string | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const ms = to - from;
  if (ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `+${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `+${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 === 0 ? `+${h}h` : `+${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return h % 24 === 0 ? `+${d}d` : `+${d}d ${h % 24}h`;
}

export function DetailTimeline({
  events,
  className,
}: {
  events: TimelineEvent[];
  className?: string;
}) {
  const present = events.filter(
    (e): e is TimelineEvent & { at: string } => Boolean(e.at),
  );
  if (present.length === 0) return null;

  const first = present[0].at;

  return (
    <ol className={cn("relative flex flex-col gap-3 pl-5", className)}>
      {/* The rail. Inset so the dots sit on it. */}
      <span
        aria-hidden
        className="absolute top-1.5 bottom-1.5 left-[3px] w-px bg-border"
      />
      {present.map((e, i) => {
        const delta = i === 0 ? null : elapsed(first, e.at);
        return (
          <li key={e.label} className="relative flex flex-col gap-0.5">
            <span
              aria-hidden
              className={cn(
                "absolute top-1 -left-5 size-[7px] rounded-full ring-2 ring-card",
                e.upcoming ? "bg-card ring-border" : "bg-primary",
              )}
            />
            <div className="flex items-baseline gap-2">
              <SectionLabel as="span">{e.label}</SectionLabel>
              {delta ? (
                <span className="text-[10px] tabular-nums text-muted-foreground/70">
                  {delta}
                </span>
              ) : null}
            </div>
            <span
              className={cn(
                "text-[15px]",
                e.upcoming && "text-muted-foreground italic",
              )}
              title={e.hint}
            >
              {e.display}
            </span>
            {e.hint ? (
              <span className="text-xs leading-snug text-muted-foreground">
                {e.hint}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
