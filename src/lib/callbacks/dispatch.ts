import "server-only";

import { BolnaApiError, initiateBolnaCall } from "@/lib/bolna/client";
import { pooledMap } from "@/lib/campaigns/dispatch";
import { createAdminClient } from "@/lib/supabase/admin";

// Per-tick ceilings. Callbacks are far lower-volume than campaign batches, so
// these are generous. Shares the cron tick with the campaign drainer.
const BATCH_LIMIT = 100;
const CONCURRENCY = 25;
// A callback is claimed (in_flight) the instant we dial; it leaves that state
// only when the result webhook lands. If that webhook is lost we'd be stuck
// forever — time it out so the row resolves. Same window as campaigns.
const STUCK_IN_FLIGHT_MS = 30 * 60 * 1000;

export interface CallbackDispatchResult {
  processed: number;
  fired: number;
}

interface DueCallback {
  id: string;
  organisation_id: string;
  lead_id: string | null;
  phone: string;
  agent_id: string;
  from_phone: string | null;
  attempt: number;
  max_attempts: number;
  retry_interval_seconds: number;
}

interface IntegrationRow {
  organisation_id: string;
  api_key: string;
  from_phone_number: string | null;
  enabled: boolean;
  callbacks_enabled: boolean;
}

/**
 * Time out callbacks whose dial was claimed but never resolved (lost webhook),
 * so a stuck row can't sit in_flight forever. The 30-min window is well past a
 * real call + its webhook. Mirrors {@link reconcileStuckCampaigns}.
 */
async function reconcileStuckCallbacks(
  admin: ReturnType<typeof createAdminClient>,
): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_IN_FLIGHT_MS).toISOString();
  await admin
    .from("scheduled_callbacks")
    .update({
      status: "failed",
      last_status: "failed",
      last_error: "No call result received — timed out",
    })
    .eq("status", "in_flight")
    .lt("updated_at", cutoff);
}

/**
 * Drain due scheduled callbacks and place outbound dials. Wired into the same
 * cron tick as the campaign drainer.
 *
 * Concurrency-safe: an optimistic CAS (UPDATE … WHERE status='pending') claims
 * each row, so overlapping ticks never double-dial. Best-effort per row — one
 * failure never aborts the batch (pooledMap isolates rejections).
 */
export async function dispatchDueCallbacks(): Promise<CallbackDispatchResult> {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  await reconcileStuckCallbacks(admin);

  const { data, error } = await admin
    .from("scheduled_callbacks")
    .select(
      "id, organisation_id, lead_id, phone, agent_id, from_phone, attempt, max_attempts, retry_interval_seconds",
    )
    .eq("status", "pending")
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(BATCH_LIMIT)
    .returns<DueCallback[]>();

  if (error) {
    console.error("[callbacks dispatch] fetch failed", error);
    throw error;
  }

  // Skip any row already at its cap (defensive — the applier marks these failed,
  // so this is belt-and-braces against a stale read).
  const queue = (data ?? []).filter((c) => c.attempt < c.max_attempts);
  if (queue.length === 0) return { processed: 0, fired: 0 };

  const orgIds = Array.from(new Set(queue.map((c) => c.organisation_id)));
  const { data: integrations } = await admin
    .from("bolna_integrations")
    .select(
      "organisation_id, api_key, from_phone_number, enabled, callbacks_enabled",
    )
    .in("organisation_id", orgIds)
    .returns<IntegrationRow[]>();
  const integrationByOrg = new Map(
    (integrations ?? []).map((i) => [i.organisation_id, i] as const),
  );

  const fired = await pooledMap(queue, CONCURRENCY, async (cb) => {
    const integration = integrationByOrg.get(cb.organisation_id);
    // Integration gone or callbacks turned off after queueing → fail the row
    // (don't silently strand it pending forever).
    if (!integration || !integration.enabled || !integration.callbacks_enabled) {
      await admin
        .from("scheduled_callbacks")
        .update({
          status: "failed",
          attempt: cb.attempt + 1,
          last_error: "Callbacks not configured/enabled",
        })
        .eq("id", cb.id)
        .eq("status", "pending");
      return { id: cb.id, ok: false };
    }

    // CAS claim — only proceed if still pending.
    const { data: claim } = await admin
      .from("scheduled_callbacks")
      .update({ status: "in_flight" })
      .eq("id", cb.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle<{ id: string }>();
    if (!claim) return { id: cb.id, ok: false };

    // Resolved at schedule time; fall back to the integration default here in
    // case the stored value was null ("" → let the provider pick its pool).
    const fromPhoneForDial = cb.from_phone || integration.from_phone_number || null;

    try {
      const result = await initiateBolnaCall({
        apiKey: integration.api_key,
        agentId: cb.agent_id,
        recipientPhone: cb.phone,
        fromPhone: fromPhoneForDial,
        metadata: {
          organisation_id: cb.organisation_id,
          scheduled_callback_id: cb.id,
          lead_id: cb.lead_id,
        },
      });

      const { data: callRow, error: callErr } = await admin
        .from("calls")
        .insert({
          organisation_id: cb.organisation_id,
          lead_id: cb.lead_id,
          scheduled_callback_id: cb.id,
          bolna_call_id: result.bolnaCallId,
          direction: "outbound",
          to_phone: cb.phone,
          from_phone: fromPhoneForDial,
          agent_id: cb.agent_id,
          status: "initiated",
        })
        .select("id")
        .single<{ id: string }>();

      if (callErr || !callRow) {
        // Couldn't record the dial — re-arm shortly so we don't lose it.
        await admin
          .from("scheduled_callbacks")
          .update({
            status: "pending",
            attempt: cb.attempt + 1,
            last_error: callErr?.message ?? "Call insert failed",
            next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
          })
          .eq("id", cb.id);
        return { id: cb.id, ok: false };
      }

      await admin
        .from("scheduled_callbacks")
        .update({
          attempt: cb.attempt + 1,
          last_call_id: callRow.id,
          last_error: null,
        })
        .eq("id", cb.id);

      return { id: cb.id, ok: true };
    } catch (err) {
      const reason =
        err instanceof BolnaApiError
          ? err.message
          : "Failed to reach the voice provider";

      // Log a failed call row for visibility, then re-arm or give up.
      await admin.from("calls").insert({
        organisation_id: cb.organisation_id,
        lead_id: cb.lead_id,
        scheduled_callback_id: cb.id,
        to_phone: cb.phone,
        from_phone: fromPhoneForDial,
        agent_id: cb.agent_id,
        status: "failed",
        direction: "outbound",
        error_message: reason.slice(0, 500),
      });

      const newAttempt = cb.attempt + 1;
      if (newAttempt >= cb.max_attempts) {
        await admin
          .from("scheduled_callbacks")
          .update({
            status: "failed",
            attempt: newAttempt,
            last_status: "failed",
            last_error: reason.slice(0, 500),
          })
          .eq("id", cb.id);
      } else {
        await admin
          .from("scheduled_callbacks")
          .update({
            status: "pending",
            attempt: newAttempt,
            last_status: "failed",
            last_error: reason.slice(0, 500),
            next_attempt_at: new Date(
              Date.now() + cb.retry_interval_seconds * 1000,
            ).toISOString(),
          })
          .eq("id", cb.id);
      }
      return { id: cb.id, ok: false };
    }
  });

  const okCount = fired.filter(
    (r) => r.status === "fulfilled" && r.value.ok,
  ).length;
  return { processed: queue.length, fired: okCount };
}
