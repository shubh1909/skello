import { SectionLabel } from "@/components/app/section-label";
import { cn } from "@/lib/utils";

/**
 * A titled block inside a detail sheet — an outlined card with a ruled header.
 *
 * ## Why it grew an outline
 *
 * Sections used to be a bare label over content, separated only by a gap. In a
 * summary made of six of them the eye had nothing to bound each one, so a long
 * description list and the timeline below it read as one continuous run and the
 * labels looked like they belonged to whatever was nearest. An outline plus a
 * rule under the header answers "where does this section end" without spending
 * a separator between every pair.
 *
 * Kills two duplication classes at once: the six verbatim
 * `text-xs font-medium uppercase tracking-widest text-muted-foreground` divs in
 * the lead sheet's call pane, and the eight-plus copies of the
 * `rounded-md border border-border/70 bg-muted/30 px-3 py-2` content-box recipe.
 *
 * ⚠️ **Don't nest a bordered box in the body.** The panel is the frame now, so
 * a bordered `dl` or note box inside one is a double edge — the exact thing
 * Stage 3 removed from `Card`. Put the content in bare, or pass `bare` to a
 * child that draws its own (see `CapturedFieldGroups`). The old `NoteCard` was
 * deleted for this reason: every one of its call sites was inside a panel.
 */
export function DetailPanel({
  title,
  action,
  children,
  tone = "default",
  flush = false,
  className,
}: {
  title?: React.ReactNode;
  /** Edit / Add / Show all — sits opposite the title. */
  action?: React.ReactNode;
  children: React.ReactNode;
  /**
   * `attention` tints the whole card — for the one thing the operator should
   * act on. It is NOT a failure: `Alert variant="destructive"` covers that.
   */
  tone?: "default" | "attention";
  /** Body with no padding, for content that must reach the card's edges. */
  flush?: boolean;
  className?: string;
}) {
  const attention = tone === "attention";

  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border",
        attention ? "border-warning/30 bg-warning-muted" : "bg-card",
        className,
      )}
    >
      {title || action ? (
        <div
          className={cn(
            "flex min-h-9 items-center justify-between gap-3 border-b px-3.5 py-2",
            attention
              ? "border-warning/25 text-warning"
              : // A teal wash, the same one the sheet header uses, so a panel
                // reads as part of the sheet rather than a card dropped on it.
                "bg-primary/3",
          )}
        >
          {title ? <SectionLabel>{title}</SectionLabel> : <span />}
          {action}
        </div>
      ) : null}
      <div
        className={cn(
          !flush && "px-3.5 py-3",
          attention && "text-[15px] leading-relaxed wrap-break-word whitespace-pre-wrap text-warning",
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** Body text for a `DetailPanel` whose whole content is one block of prose. */
export function PanelProse({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-[15px] leading-relaxed wrap-break-word whitespace-pre-wrap",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** Two panels side by side above `md` — the signals/risks pairing. */
export function PanelGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-3 md:grid-cols-2", className)}>{children}</div>
  );
}
