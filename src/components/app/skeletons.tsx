import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Page header (title + subtitle + optional action buttons), sized to match
 * the real headers on /leads, /callers, /conversations, /campaigns, etc.
 */
export function PageHeaderSkeleton({
  actionCount = 1,
}: {
  actionCount?: number;
}) {
  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="space-y-2">
        <Skeleton className="h-9 w-48 md:h-10 md:w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      {actionCount > 0 ? (
        <div className="flex items-center gap-2">
          {Array.from({ length: actionCount }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-28" />
          ))}
        </div>
      ) : null}
    </header>
  );
}

/** Four stat cards in a responsive grid — matches StatCard's visual weight. */
export function StatCardGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <section className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="gap-4 p-6">
          <div className="flex items-center gap-2">
            <Skeleton className="size-3.5 rounded-sm" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-3 w-32" />
        </Card>
      ))}
    </section>
  );
}

/** A single row of filter pills (used by /leads tabs and similar nav strips). */
export function FilterTabsSkeleton({ count = 2 }: { count?: number }) {
  return (
    <nav className="flex items-center gap-1 text-sm">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-7 w-24" />
      ))}
    </nav>
  );
}

/**
 * Generic table skeleton with a header row and N body rows. Sized loosely
 * — the goal is to match the shape, not pixel-match every column. Use
 * `columns` to tune to the page.
 */
export function TableSkeleton({
  rows = 8,
  columns = 6,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <Card className={cn("overflow-hidden p-0", className)}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border/60 bg-muted/30">
            <tr>
              {Array.from({ length: columns }).map((_, i) => (
                <th key={i} className="px-4 py-4">
                  <Skeleton className="h-3 w-20" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r}>
                {Array.from({ length: columns }).map((_, c) => (
                  <td key={c} className="px-4 py-5">
                    {/* First column gets a slightly wider cell so the visual
                        weight roughly matches a Name + subtitle layout. */}
                    {c === 0 ? (
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    ) : (
                      <Skeleton className="h-4 w-16" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Vertical stack of items (used for /reminders). */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Card className="overflow-hidden p-0">
      <ul className="divide-y divide-border/60">
        {Array.from({ length: rows }).map((_, i) => (
          <li
            key={i}
            className="flex items-start gap-3 px-4 py-3 md:px-5"
          >
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="size-7 shrink-0 rounded-md" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Footer line that mimics the InfiniteScrollFooter when idle. */
export function InfiniteScrollFooterSkeleton() {
  return (
    <div className="flex justify-center py-6">
      <Skeleton className="h-3 w-48" />
    </div>
  );
}
