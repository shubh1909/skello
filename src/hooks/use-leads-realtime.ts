"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

const REFRESH_DEBOUNCE_MS = 350;

/**
 * Subscribe to leads changes for one organisation and trigger a server
 * refresh on every burst of events. Refresh is debounced so a flurry of
 * inserts (e.g. CSV import) coalesces into a single round-trip.
 *
 * Realtime must be enabled on `public.leads` for the supabase publication.
 * RLS still gates which events the client receives, so cross-tenant leaks
 * are not possible from this subscription alone.
 */
export function useLeadsRealtime(
  orgSlug: string | null | undefined,
  paused: boolean = false,
) {
  const router = useRouter();
  // Read-through ref so the subscription callback always sees the latest
  // pause state without rebuilding the channel.
  const pausedRef = React.useRef(paused);
  pausedRef.current = paused;

  React.useEffect(() => {
    if (!orgSlug) return;

    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;

    function queueRefresh() {
      if (pausedRef.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        router.refresh();
      }, REFRESH_DEBOUNCE_MS);
    }

    const channel = supabase
      .channel(`leads:${orgSlug}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "leads",
          filter: `org_slug=eq.${orgSlug}`,
        },
        queueRefresh,
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [orgSlug, router]);
}
