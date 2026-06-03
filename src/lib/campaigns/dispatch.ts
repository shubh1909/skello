import "server-only";

import { BolnaApiError, initiateBolnaCall } from "@/lib/bolna/client";
import { createAdminClient } from "@/lib/supabase/admin";

// Drained per call to dispatchDueCampaignContacts(). Bolna API throughput is
// the binding constraint, not Postgres — keep batches small so one big
// campaign can't starve others.
const BATCH_LIMIT = 25;
const PER_CAMPAIGN_LIMIT = 10;
// Max simultaneous Bolna /call requests in flight. Stays well under any
// telephony provider's concurrent-call ceiling and avoids stampeding their
// rate limit. 5 workers × ~1s/call = 25 contacts processed in ~5 seconds.
const CONCURRENCY = 5;
// A contact is claimed (status='in_flight') the instant we dial it, and only
// leaves that state when the provider's result webhook lands. If that webhook
// is lost, delayed, or arrives unmatched, the contact — and therefore the
// whole campaign — would be stuck "in flight" forever. After this long with
// no result we give up on the dial and mark it failed so the campaign can
// finish. Generous on purpose: a real call + its webhook resolve well inside
// this window.
const STUCK_IN_FLIGHT_MS = 30 * 60 * 1000;

/**
 * Run `fn` over `items` with a fixed worker pool. Preserves
 * Promise.allSettled semantics — every item runs to completion regardless of
 * whether siblings reject, and the result array is in submission order.
 */
async function pooledMap<T, U>(
  items: T[],
  workers: number,
  fn: (item: T, index: number) => Promise<U>,
): Promise<PromiseSettledResult<U>[]> {
  const results: PromiseSettledResult<U>[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      try {
        results[idx] = { status: "fulfilled", value: await fn(items[idx], idx) };
      } catch (reason) {
        results[idx] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(workers, items.length) }, worker),
  );
  return results;
}

/**
 * Repair campaigns that the happy-path can't close on its own.
 *
 * Two failure modes, both of which leave a campaign showing "Running" forever:
 *   1. A contact was dialed (status='in_flight') but its result webhook never
 *      landed (lost / delayed / unmatched). It would sit in_flight forever.
 *   2. Every contact is already terminal, but the auto-complete trigger — which
 *      only fires on a contact row *change* — missed the final flip.
 *
 * Runs at the top of every dispatch tick. Cheap: both queries are indexed on
 * status and bounded by the small number of active campaigns.
 */
export async function reconcileStuckCampaigns(): Promise<void> {
  const admin = createAdminClient();

  // (1) Time out abandoned in-flight contacts. updated_at was bumped to the
  // dial time when we set status='in_flight', so it's our "claimed at" clock.
  const cutoff = new Date(Date.now() - STUCK_IN_FLIGHT_MS).toISOString();
  await admin
    .from("campaign_contacts")
    .update({
      status: "failed",
      last_status: "failed",
      last_error: "No call result received — timed out",
    })
    .eq("status", "in_flight")
    .lt("updated_at", cutoff);

  // (2) Close out any in_progress campaign with nothing left to do. We can't
  // express the "no pending/in_flight children" check in one PostgREST call,
  // so find candidates that still have open contacts and exclude them.
  const { data: active } = await admin
    .from("campaigns")
    .select("id")
    .eq("status", "in_progress")
    .returns<{ id: string }[]>();
  if (!active || active.length === 0) return;

  const { data: openContacts } = await admin
    .from("campaign_contacts")
    .select("campaign_id")
    .in(
      "campaign_id",
      active.map((c) => c.id),
    )
    .in("status", ["pending", "in_flight"])
    .returns<{ campaign_id: string }[]>();
  const stillBusy = new Set((openContacts ?? []).map((r) => r.campaign_id));

  const doneIds = active.map((c) => c.id).filter((id) => !stillBusy.has(id));
  if (doneIds.length === 0) return;

  await admin
    .from("campaigns")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .in("id", doneIds)
    .eq("status", "in_progress");
}

interface DueContact {
  id: string;
  campaign_id: string;
  organisation_id: string;
  phone: string;
  name: string | null;
  metadata: Record<string, unknown>;
  attempt: number;
  campaign: {
    id: string;
    organisation_id: string;
    status: string;
    max_attempts: number;
    agent_id: string | null;
    from_phone_number: string | null;
  } | null;
}

export interface DispatchResult {
  processed: number;
  fired: number;
}

/**
 * Drain pending campaign contacts and place outbound dials.
 *
 * Used by:
 *   - GET /api/cron/campaigns/tick — Supabase pg_cron pings this every minute
 *     in production.
 *   - actions/campaigns.createCampaign — fires this immediately after a
 *     "Run Now" campaign is saved, so the operator doesn't have to wait for
 *     the next cron tick. Critical for local dev (pg_cron on Supabase Cloud
 *     can't reach localhost) and feels snappier in prod too.
 *
 * Concurrency: optimistic CAS on contact rows (UPDATE … WHERE status =
 * 'pending') guards against two overlapping dispatches double-claiming the
 * same row. Safe to call from both code paths simultaneously.
 */
export async function dispatchDueCampaignContacts(): Promise<DispatchResult> {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  // Self-heal before dispatching: time out abandoned in-flight contacts and
  // close out any campaign that has no work left. This is what makes the
  // progress/status truthful even when a result webhook never arrived.
  await reconcileStuckCampaigns();

  // Flip any 'scheduled' campaigns whose start time has arrived.
  await admin
    .from("campaigns")
    .update({ status: "in_progress", started_at: nowIso })
    .eq("status", "scheduled")
    .lte("scheduled_at", nowIso);

  const { data, error } = await admin
    .from("campaign_contacts")
    .select(
      "id, campaign_id, organisation_id, phone, name, metadata, attempt, campaign:campaigns!campaign_id(id, organisation_id, status, max_attempts, agent_id, from_phone_number)",
    )
    .eq("status", "pending")
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(BATCH_LIMIT * 2)
    .returns<DueContact[]>();

  if (error) {
    console.error("[campaigns dispatch] fetch failed", error);
    throw error;
  }

  // Cap per campaign for fairness, then take the global head.
  const perCampaign = new Map<string, number>();
  const queue: DueContact[] = [];
  for (const c of data ?? []) {
    if (!c.campaign || c.campaign.status !== "in_progress") continue;
    if (c.attempt >= c.campaign.max_attempts) continue;
    const used = perCampaign.get(c.campaign_id) ?? 0;
    if (used >= PER_CAMPAIGN_LIMIT) continue;
    perCampaign.set(c.campaign_id, used + 1);
    queue.push(c);
    if (queue.length >= BATCH_LIMIT) break;
  }

  if (queue.length === 0) {
    return { processed: 0, fired: 0 };
  }

  // Cache integrations per org — usually just one org per dispatch.
  const orgIds = Array.from(new Set(queue.map((c) => c.organisation_id)));
  const { data: integrations } = await admin
    .from("bolna_integrations")
    .select("organisation_id, agent_id, api_key, from_phone_number, enabled")
    .in("organisation_id", orgIds)
    .returns<
      Array<{
        organisation_id: string;
        agent_id: string;
        api_key: string;
        from_phone_number: string | null;
        enabled: boolean;
      }>
    >();
  const integrationByOrg = new Map(
    (integrations ?? []).map((i) => [i.organisation_id, i] as const),
  );

  const fired = await pooledMap(queue, CONCURRENCY, async (contact) => {
      const integration = integrationByOrg.get(contact.organisation_id);
      if (!integration || !integration.enabled) {
        await admin
          .from("campaign_contacts")
          .update({
            status: "failed",
            attempt: contact.attempt + 1,
            last_error: "Voice agent not configured",
          })
          .eq("id", contact.id);
        return { id: contact.id, ok: false, reason: "no_integration" };
      }

      // CAS claim — only proceed if the row is still pending.
      const { data: claim } = await admin
        .from("campaign_contacts")
        .update({ status: "in_flight" })
        .eq("id", contact.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle<{ id: string }>();
      if (!claim) {
        return { id: contact.id, ok: false, reason: "lost_claim" };
      }

      // Per-campaign overrides win; null fields fall back to the org default
      // stored on bolna_integrations.
      const resolvedAgentId =
        contact.campaign?.agent_id ?? integration.agent_id;
      const resolvedFromPhone =
        contact.campaign?.from_phone_number ?? integration.from_phone_number;

      try {
        const result = await initiateBolnaCall({
          apiKey: integration.api_key,
          agentId: resolvedAgentId,
          recipientPhone: contact.phone,
          fromPhone: resolvedFromPhone,
          metadata: {
            organisation_id: contact.organisation_id,
            campaign_id: contact.campaign_id,
            campaign_contact_id: contact.id,
            contact_name: contact.name,
            ...contact.metadata,
          },
        });

        const { data: callRow, error: callErr } = await admin
          .from("calls")
          .insert({
            organisation_id: contact.organisation_id,
            campaign_contact_id: contact.id,
            bolna_call_id: result.bolnaCallId,
            direction: "outbound",
            to_phone: contact.phone,
            from_phone: resolvedFromPhone,
            agent_id: resolvedAgentId,
            status: "initiated",
          })
          .select("id")
          .single<{ id: string }>();

        if (callErr || !callRow) {
          await admin
            .from("campaign_contacts")
            .update({
              status: "pending",
              attempt: contact.attempt + 1,
              last_error: callErr?.message ?? "Call insert failed",
              next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
            })
            .eq("id", contact.id);
          return { id: contact.id, ok: false, reason: "call_insert" };
        }

        await admin
          .from("campaign_contacts")
          .update({
            attempt: contact.attempt + 1,
            last_call_id: callRow.id,
            last_error: null,
          })
          .eq("id", contact.id);

        return { id: contact.id, ok: true };
      } catch (err) {
        const reason =
          err instanceof BolnaApiError
            ? err.message
            : "Failed to reach the voice provider";

        // Provider-level failure: log a failed call row for visibility, then
        // either re-arm for another retry or mark the contact failed if the
        // attempt cap is now hit.
        await admin.from("calls").insert({
          organisation_id: contact.organisation_id,
          campaign_contact_id: contact.id,
          to_phone: contact.phone,
          from_phone: resolvedFromPhone,
          agent_id: resolvedAgentId,
          status: "failed",
          direction: "outbound",
          error_message: reason.slice(0, 500),
        });

        const newAttempt = contact.attempt + 1;
        const cap = contact.campaign?.max_attempts ?? 1;
        if (newAttempt >= cap) {
          await admin
            .from("campaign_contacts")
            .update({
              status: "failed",
              attempt: newAttempt,
              last_status: "failed",
              last_error: reason.slice(0, 500),
            })
            .eq("id", contact.id);
        } else {
          const { data: cfg } = await admin
            .from("campaigns")
            .select("retry_interval_seconds")
            .eq("id", contact.campaign_id)
            .maybeSingle<{ retry_interval_seconds: number }>();
          const intervalSec = cfg?.retry_interval_seconds ?? 900;
          await admin
            .from("campaign_contacts")
            .update({
              status: "pending",
              attempt: newAttempt,
              last_status: "failed",
              last_error: reason.slice(0, 500),
              next_attempt_at: new Date(
                Date.now() + intervalSec * 1000,
              ).toISOString(),
            })
            .eq("id", contact.id);
        }
        return { id: contact.id, ok: false, reason: "bolna_error" };
      }
    });

  const okCount = fired.filter(
    (r) => r.status === "fulfilled" && r.value.ok,
  ).length;

  return { processed: queue.length, fired: okCount };
}
