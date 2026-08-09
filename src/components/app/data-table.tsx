import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Shared chrome for the app's data tables.
 *
 * Six tables each hand-rolled the same three things: a `Card` with
 * `overflow-hidden p-0`, a `<thead>` with
 * `border-b border-border/60 bg-muted/30`, and a header `<tr>` with
 * `text-xs font-medium uppercase tracking-wider text-muted-foreground`. Nothing
 * shared them, so the recipe drifted — `cod-confirmations-table` never got the
 * `bg-muted/30`, and the head label size disagreed with `SectionLabel` everywhere.
 *
 * This deliberately does NOT abstract columns, sorting or rows. Two of the six
 * tables use `table-fixed` + `<colgroup>` with drag-resizable column widths
 * persisted to localStorage, and one is catalog-driven; a single generic
 * `DataTable` would either fight them or force them all through the lowest common
 * denominator. Only the chrome is shared, which is all that was ever duplicated.
 *
 * shadcn's `table` primitive was considered and dropped: adopting it means
 * rewriting every `<th>`/`<td>` in files Stage 4 restructures anyway, and
 * adopting it in only the simple tables leaves a half-migration — worse than
 * either end state.
 */

/** Card shell: clips the head's border radius and drops the default padding. */
export function DataTableCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-0 overflow-hidden p-0", className)}>
      {children}
    </Card>
  );
}

/**
 * A title/actions bar above the table — the "Recent orders · 1,204 total" row.
 * Optional; tables with a filter bar use that instead.
 */
export function DataTableToolbar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 border-b border-border/60 px-4 py-3.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * `<thead>` + the header `<tr>` in one, so a caller writes only its `<th>`s and
 * cannot get the two class strings out of step.
 *
 * Columns stay the caller's business — pass `<th>` children exactly as before.
 *
 * There were six variants of this across eleven `<thead>`s: the fill sometimes on
 * the `<thead>` and sometimes on the `<tr>`, `text-xs` vs `text-[11px]`,
 * `tracking-wider` vs `tracking-widest`, and `bg-muted/30` present or missing.
 * Two axes of that were real distinctions worth keeping, so they're props.
 */
export function DataTableHead({
  children,
  className,
  rowClassName,
  filled = true,
  sticky = false,
}: {
  children: React.ReactNode;
  className?: string;
  rowClassName?: string;
  /**
   * The muted fill. Top-level tables want it (it separates the head from a long
   * body); tables nested inside a Card that already has its own header do not —
   * two stacked fills read as a mistake.
   */
  filled?: boolean;
  /** For tables inside their own scroll container, e.g. the CSV import preview. */
  sticky?: boolean;
}) {
  return (
    <thead
      className={cn(
        "border-b border-border/60",
        filled && "bg-muted/40",
        sticky && "sticky top-0 z-10",
        className,
      )}
    >
      <tr
        className={cn(
          // Matches SectionLabel — a column header is the same semantic role, so
          // it should not be a fourth size.
          "text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground",
          rowClassName,
        )}
      >
        {children}
      </tr>
    </thead>
  );
}
