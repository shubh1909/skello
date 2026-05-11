"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";

interface InfiniteScrollFooterProps {
  loading: boolean;
  hasMore: boolean;
  loadedCount: number;
  total: number;
  /** Forwarded from useInfiniteList — IntersectionObserver attaches here. */
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  /** Hide the "all caught up" line when the list is empty. */
  hideEmpty?: boolean;
}

export function InfiniteScrollFooter({
  loading,
  hasMore,
  loadedCount,
  total,
  sentinelRef,
  hideEmpty,
}: InfiniteScrollFooterProps) {
  if (loadedCount === 0 && hideEmpty) return null;
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-xs text-muted-foreground">
      {hasMore ? (
        <>
          <div ref={sentinelRef} aria-hidden className="h-px w-full" />
          {loading ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2Icon className="size-3 animate-spin" /> Loading more…
            </span>
          ) : (
            <span className="tabular-nums">
              Showing {loadedCount.toLocaleString()} of{" "}
              {total.toLocaleString()} · scroll for more
            </span>
          )}
        </>
      ) : (
        <span className="tabular-nums">
          {loadedCount.toLocaleString()} of {total.toLocaleString()} · all caught up
        </span>
      )}
    </div>
  );
}
