"use client";

import * as React from "react";

/**
 * Returns `null` during SSR and the initial client render, then `Date.now()`
 * after mount. Use this to gate any UI that depends on the current time —
 * relative timestamps, overdue flags, "now" comparisons — so that the
 * server-rendered HTML matches the client's first paint and hydration
 * succeeds without a mismatch.
 */
export function useClientNow(): number | null {
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNow(Date.now());
  }, []);
  return now;
}
