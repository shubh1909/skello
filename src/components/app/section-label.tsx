import { cn } from "@/lib/utils";

/**
 * The small-caps label above a group of fields, a panel body or a table.
 *
 * There were three combinations in play for this one semantic role —
 * `text-[10px] uppercase tracking-widest` (sidebar, transcript dialog),
 * `text-xs uppercase tracking-widest` (stat cards, dashboard eyebrow, the lead
 * sheet's call pane) and `text-xs uppercase tracking-wider` (recovery drawers,
 * every table `<thead>`). Three sizes for the same job is the kind of thing
 * nobody notices individually and everybody feels in aggregate.
 *
 * This settles on the reference's `.sect`: 10px, semibold, 0.1em tracking.
 */
export function SectionLabel({
  children,
  className,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  /**
   * `span` inside a flex row, `p` for a standalone eyebrow, `dt`/`th` where the
   * semantics call for it, `h3` when it genuinely heads a section.
   */
  as?: "div" | "span" | "p" | "dt" | "th" | "h3";
}) {
  return (
    <Tag
      className={cn(
        "text-[10px] font-semibold uppercase tracking-widest text-muted-foreground",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
