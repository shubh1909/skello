"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

const REFRESH_DEBOUNCE_MS = 350;

/**
 * Subscribe to campaign + contact changes for one organisation. Coalesces
 * the rapid bursts that come from a campaign in flight (every webhook flips
 * one contact + the trigger updates the parent counters) into a single
 * server refresh.
 *
 * Realtime must be enabled on `public.campaigns` and
 * `public.campaign_contacts` in the Supabase publication.
 */
export function useCampaignsRealtime(
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
      .channel(`campaigns:${organisationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "campaigns",
          filter: `organisation_id=eq.${organisationId}`,
        },
        queueRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "campaign_contacts",
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
