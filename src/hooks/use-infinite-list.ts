"use client";

import * as React from "react";

export interface UseInfiniteListOptions<Row> {
  /** First page of rows, server-rendered. */
  initialItems: Row[];
  /** Total row count across all pages. Used to know when we've reached the end. */
  initialTotal: number;
  /** Page size for subsequent fetches. */
  pageSize: number;
  /**
   * Fetch a page starting at `offset` of size `limit`. Return `null` to abort
   * silently (e.g. an action returned `{ success: false }` and the caller has
   * already toasted).
   */
  fetchPage: (
    offset: number,
    limit: number,
  ) => Promise<{ items: Row[]; total: number } | null>;
  /**
   * Optional reset trigger. When this string changes between renders, the
   * hook discards the current items, refetches from offset 0 using the
   * current `fetchPage`, and resets `pagedBeyondInitial` to false. Use it
   * when client-side state (sort, filter chips, search text) affects the
   * result set but the server component isn't re-rendering. The string is
   * a content key — `JSON.stringify({ ... })` of the relevant inputs is
   * the usual recipe.
   */
  resetKey?: string;
}

export interface UseInfiniteListResult<Row> {
  items: Row[];
  total: number;
  loading: boolean;
  hasMore: boolean;
  /** True once we've fetched at least one page beyond the initial server-rendered batch. Pass to realtime hooks to pause auto-refresh. */
  pagedBeyondInitial: boolean;
  /** Attach to a 1px sentinel element placed below your last row. */
  sentinelRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Generic infinite-scroll driver. The list component owns the rendered DOM;
 * this hook owns the row array, the IntersectionObserver, and the "loaded
 * beyond initial" flag used to pause realtime refresh.
 *
 * Filter changes: the parent should remount the table component (e.g. via a
 * `key` derived from the filter signature) so the hook re-initializes from
 * fresh props.
 *
 * SSR refreshes (router.refresh() after a server-action mutation, or a
 * realtime CHANGE event): we re-sync `items`/`total` to the new
 * `initialItems`/`initialTotal` *only* while `pagedBeyondInitial` is false.
 * That covers the common "user creates a row → it should appear at top"
 * flow without clobbering loaded pages when the user is mid-scroll.
 */
export function useInfiniteList<Row>({
  initialItems,
  initialTotal,
  pageSize,
  fetchPage,
  resetKey,
}: UseInfiniteListOptions<Row>): UseInfiniteListResult<Row> {
  const [items, setItems] = React.useState<Row[]>(initialItems);
  const [total, setTotal] = React.useState(initialTotal);
  const [loading, setLoading] = React.useState(false);
  const [pagedBeyondInitial, setPagedBeyondInitial] = React.useState(false);

  const sentinelRef = React.useRef<HTMLDivElement | null>(null);

  // Re-sync to the server-rendered batch whenever the parent passes a fresh
  // `initialItems` reference (router.refresh() after a server-action
  // mutation; or a realtime CHANGE event). Only applied while the user is
  // still on the initial page — once they've paged beyond, an unsolicited
  // reset would lose the loaded rows. Deferred via queueMicrotask so the
  // setState calls don't run during the same tick as the effect's body
  // (avoids the set-state-in-effect lint rule's cascading-render concern).
  React.useEffect(() => {
    if (pagedBeyondInitial) return;
    queueMicrotask(() => {
      setItems(initialItems);
      setTotal(initialTotal);
    });
  }, [initialItems, initialTotal, pagedBeyondInitial]);

  // Refs so the IntersectionObserver callback always reads the current values
  // without re-creating the observer every time the row array grows.
  const itemsLenRef = React.useRef(items.length);
  itemsLenRef.current = items.length;
  const totalRef = React.useRef(total);
  totalRef.current = total;
  const loadingRef = React.useRef(loading);
  loadingRef.current = loading;
  const fetchPageRef = React.useRef(fetchPage);
  fetchPageRef.current = fetchPage;

  // Client-driven reset. When `resetKey` changes (filter chip added,
  // sort toggled, search submitted) we throw away the current page,
  // refetch offset 0 with the current fetchPage closure, and put the
  // user back on the initial-page footing. Skipped on first render so
  // we don't double-fetch the data the server already rendered.
  const prevResetKey = React.useRef(resetKey);
  React.useEffect(() => {
    if (resetKey === undefined) return;
    if (resetKey === prevResetKey.current) return;
    prevResetKey.current = resetKey;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const result = await fetchPageRef.current(0, pageSize);
        if (cancelled) return;
        if (result) {
          setItems(result.items);
          setTotal(result.total);
          setPagedBeyondInitial(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resetKey, pageSize]);

  React.useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;

    async function loadMore() {
      if (loadingRef.current) return;
      if (itemsLenRef.current >= totalRef.current) return;
      setLoading(true);
      try {
        const result = await fetchPageRef.current(
          itemsLenRef.current,
          pageSize,
        );
        if (!result) return;
        setItems((prev) => [...prev, ...result.items]);
        setTotal(result.total);
        setPagedBeyondInitial(true);
      } finally {
        setLoading(false);
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          void loadMore();
        }
      },
      // Pre-fetch a bit before the sentinel is actually visible so scrolling
      // never has to wait for a network round trip.
      { rootMargin: "400px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [pageSize]);

  return {
    items,
    total,
    loading,
    hasMore: items.length < total,
    pagedBeyondInitial,
    sentinelRef,
  };
}
