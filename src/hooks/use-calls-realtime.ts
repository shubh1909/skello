"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

const REFRESH_DEBOUNCE_MS = 350;

/**
 * Subscribe to call changes for one organisation and trigger a server
 * refresh on every burst of events. Refresh is debounced so the rapid-fire
 * status transitions Bolna emits during a single call coalesce into one
 * round-trip.
 *
 * Realtime must be enabled on `public.calls` in the Supabase publication.
 * RLS still gates which events the client receives.
 */
export function useCallsRealtime(
  organisationId: string | null | undefined,
  paused: boolean = false,
) {
  const router = useRouter();
  // Read-through ref so the subscription callback always sees the latest
  // pause state without rebuilding the channel.
  const pausedRef = React.useRef(paused);
  pausedRef.current = paused;

  React.useEffect(() => {
    if (!organisationId) return;

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
      .channel(`calls:${organisationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "calls",
          filter: `organisation_id=eq.${organisationId}`,
        },
        queueRefresh,
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [organisationId, router]);
}
