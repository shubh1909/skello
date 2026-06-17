import "server-only";

import { BolnaApiError, initiateBolnaCall } from "@/lib/bolna/client";
import { createAdminClient } from "@/lib/supabase/admin";

// Throughput per tick. The cron fires every minute (createCampaign also kicks
// off a dispatch immediately), so these are effectively per-minute ceilings.
// The provider queues calls with no rate limit of its own, and we run on a
// self-hosted VM (no serverless function timeout), so the real governors are:
//   1. finishing a tick before any reverse-proxy / pg_net read timeout,
//   2. the per-number daily spam cap × caller-ID pool size — this bounds
//      SUSTAINED volume regardless of the numbers here (you can't out-dial the
//      pool; excess contacts just defer), and
//   3. the webhook ingest rate limit (~2000 events/min).
// PER_CAMPAIGN_LIMIT keeps one big campaign from starving others while still
// letting it move fast.
const BATCH_LIMIT = 250; // total dials per tick across all campaigns
const PER_CAMPAIGN_LIMIT = 100; // dials per tick for any single campaign
// Max simultaneous provider /call requests in flight. The provider imposes no
// concurrency ceiling; we cap it so the VM's event loop + Supabase round-trips
// stay healthy and a tick drains quickly. ~25 workers × ~1.5s/call drains a
// 250-dial batch in ~15s — well under a typical 60s proxy timeout.
const CONCURRENCY = 25;
// A contact is claimed (status='in_flight') the instant we dial it, and only
// leaves that state when the provider's result webhook lands. If that webhook
// is lost, delayed, or arrives unmatched, the contact — and therefore the
// whole campaign — would be stuck "in flight" forever. After this long with
// no result we give up on the dial and mark it failed so the campaign can
// finish. Generous on purpose: a real call + its webhook resolve well inside
// this window.
const STUCK_IN_FLIGHT_MS = 30 * 60 * 1000;
// Spam avoidance via CONNECT-RATE switching (replaces the old fixed daily cap).
// Per campaign, we watch each caller-ID's connect rate over a rolling window and
// rest any number whose rate falls below the campaign's floor — the direct
// symptom of being spam-flagged. When EVERY number is resting we defer the
// contact with escalating backoff; after a few rounds we dial from the
// least-bad number so the run still finishes (operator's choice — completion
// over number-preservation, surfaced as a "degraded" badge on the dashboard).
const MAX_HEALTH_BACKOFF_ROUNDS = 3;
// Backoff per all-resting deferral: 30m, then 60m, then 120m (base × 2^round).
const HEALTH_DEFER_BASE_MS = 30 * 60 * 1000;
// Upper bound on the raw call rows we pull to compute number health. Windows are
// minutes-scale so this is generous; a busier-than-this org would slightly
// undercount, which only makes switching MORE conservative (safe).
const HEALTH_ROW_LIMIT = 50000;
// A call only informs connect rate once it has reached a TERMINAL state — only
// then do we know whether it connected. An in-flight dial (initiated / ringing
// / in_progress) has no verdict yet; counting it as a "dial" with zero connects
// would read a fresh burst as ~0% connect rate and rest EVERY caller-ID,
// throttling the whole campaign to a deferral crawl. So health is computed over
// resolved calls only — an unresolved dial simply doesn't count until it lands.
export const RESOLVED_CALL_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "no_answer",
  "busy",
  "failed",
  "canceled",
]);

/**
 * Run `fn` over `items` with a fixed worker pool. Preserves
 * Promise.allSettled semantics — every item runs to completion regardless of
 * whether siblings reject, and the result array is in submission order.
 */
export async function pooledMap<T, U>(
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

export interface DueContact {
  id: string;
  campaign_id: string;
  organisation_id: string;
  phone: string;
  name: string | null;
  metadata: Record<string, unknown>;
  attempt: number;
  // Honored callbacks grant extra dial allowance on top of max_attempts.
  callback_count: number;
  // All-resting deferrals so far (drives backoff → least-bad fallback).
  health_defer_count: number;
  campaign: {
    id: string;
    organisation_id: string;
    status: string;
    max_attempts: number;
    agent_id: string | null;
    from_phone_number: string | null;
    from_phone_numbers: string[] | null;
    switch_connect_rate_floor: number;
    switch_window_minutes: number;
    switch_min_samples: number;
  } | null;
}

export interface DispatchResult {
  processed: number;
  fired: number;
}

export type IntegrationRow = {
  organisation_id: string;
  agent_id: string;
  api_key: string;
  from_phone_number: string | null;
  enabled: boolean;
};

// Health of one caller-ID over the measurement window: how many dials it placed
// and how many connected. Connect rate = connects / dials.
export interface NumberHealth {
  dials: number;
  connects: number;
}

// A single outbound call used to compute number health.
interface CallRow {
  organisation_id: string;
  from_phone: string | null;
  status: string;
  started_at: string;
}

// Pull recent outbound calls (with caller-ID + status) for the given orgs over
// the longest window any campaign in this batch needs. We compute per-campaign
// windows from this one set in memory. Org-scoped so one tenant's volume never
// colours another's number health.
async function loadNumberCalls(
  admin: ReturnType<typeof createAdminClient>,
  orgIds: string[],
  windowMs: number,
): Promise<CallRow[]> {
  if (orgIds.length === 0) return [];
  const since = new Date(Date.now() - windowMs).toISOString();
  const { data } = await admin
    .from("calls")
    .select("organisation_id, from_phone, status, started_at")
    .in("organisation_id", orgIds)
    .eq("direction", "outbound")
    // Only resolved calls inform connect rate — see RESOLVED_CALL_STATUSES.
    // Filtering here also keeps in-flight dials out of the row budget.
    .in("status", Array.from(RESOLVED_CALL_STATUSES))
    .gte("started_at", since)
    .not("from_phone", "is", null)
    .limit(HEALTH_ROW_LIMIT)
    .returns<CallRow[]>();
  return data ?? [];
}

// Build per-number health from the loaded rows, restricted to a window.
// `completed` is our connected signal (the call answered + ran).
export function computeNumberHealth(
  rows: CallRow[],
  windowMs: number,
  now: number,
): Map<string, NumberHealth> {
  const cutoff = now - windowMs;
  const health = new Map<string, NumberHealth>();
  for (const row of rows) {
    if (!row.from_phone) continue;
    if (new Date(row.started_at).getTime() < cutoff) continue;
    // Skip unresolved dials — they have no connect verdict yet and would
    // otherwise tank a fresh burst's measured rate to ~0%. Defence in depth:
    // loadNumberCalls already filters these out at the query.
    if (!RESOLVED_CALL_STATUSES.has(row.status)) continue;
    const h = health.get(row.from_phone) ?? { dials: 0, connects: 0 };
    h.dials += 1;
    if (row.status === "completed") h.connects += 1;
    health.set(row.from_phone, h);
  }
  return health;
}

export interface PickNumberInput {
  pool: string[];
  // Single fallback (campaign override → org default) used when no pool is set.
  singleOverride: string | null;
  health: Map<string, NumberHealth>;
  // In-batch dial counts so we spread across eligible numbers within a tick.
  batchUsage: Map<string, number>;
  floorPct: number;
  minSamples: number;
  // After backoff is exhausted, allow dialing the least-bad resting number.
  allowLeastBad: boolean;
}

export type PickNumberResult =
  | { kind: "dial"; number: string; degraded: boolean }
  | { kind: "defer" };

// Decide which caller-ID to dial from based on connect-rate health.
//   - A number is ELIGIBLE if it has too few samples to judge (give it a
//     chance) OR its connect rate is at/above the floor.
//   - Among eligible numbers, pick the least-loaded (window dials + in-batch
//     dials) so volume spreads instead of dumping on the single healthiest one.
//   - If ALL numbers are resting: defer, unless backoff is exhausted
//     (allowLeastBad) — then dial the highest-connect-rate number (degraded).
//   - No numbers configured at all → dial with no caller-ID (provider's pool).
export function pickHealthyNumber(input: PickNumberInput): PickNumberResult {
  const { health, batchUsage, floorPct, minSamples, allowLeastBad } = input;
  const candidates =
    input.pool.length > 0
      ? input.pool
      : input.singleOverride
        ? [input.singleOverride]
        : [];

  // Nothing configured — let the provider choose from its own pool.
  if (candidates.length === 0) {
    return { kind: "dial", number: FALLBACK_NO_NUMBER, degraded: false };
  }

  const load = (n: string) =>
    (health.get(n)?.dials ?? 0) + (batchUsage.get(n) ?? 0);
  const rate = (n: string): number | null => {
    const h = health.get(n);
    if (!h || h.dials < minSamples) return null; // too few samples → unknown
    return (h.connects / h.dials) * 100;
  };

  const healthy = candidates.filter((n) => {
    const r = rate(n);
    return r === null || r >= floorPct;
  });

  if (healthy.length > 0) {
    // Least-loaded first; ties keep candidate order (stable rotation).
    const best = healthy.reduce((a, b) => (load(b) < load(a) ? b : a));
    return { kind: "dial", number: best, degraded: false };
  }

  // Every candidate is resting (each has >= minSamples and rate < floor).
  if (!allowLeastBad) return { kind: "defer" };

  // Least-bad: highest connect rate; ties broken by least load.
  const leastBad = candidates.reduce((a, b) => {
    const ra = rate(a) ?? 0;
    const rb = rate(b) ?? 0;
    if (rb > ra) return b;
    if (rb === ra && load(b) < load(a)) return b;
    return a;
  });
  return { kind: "dial", number: leastBad, degraded: true };
}

// Sentinel: an empty string tells the dial path to omit from_phone_number so
// Bolna dials from its own default pool. Distinct from `null` ("deferred").
export const FALLBACK_NO_NUMBER = "";

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
      "id, campaign_id, organisation_id, phone, name, metadata, attempt, callback_count, health_defer_count, campaign:campaigns!campaign_id(id, organisation_id, status, max_attempts, agent_id, from_phone_number, from_phone_numbers, switch_connect_rate_floor, switch_window_minutes, switch_min_samples)",
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
    // Dial allowance = technical retries (max_attempts) + one per honored
    // callback. A customer-requested callback never gets starved by no-answers.
    if (c.attempt >= c.campaign.max_attempts + c.callback_count) continue;
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
    .returns<IntegrationRow[]>();
  const integrationByOrg = new Map(
    (integrations ?? []).map((i) => [i.organisation_id, i] as const),
  );

  // Number health for switching. Load recent outbound calls once over the
  // LONGEST window any campaign in this batch needs, then compute each
  // campaign's per-number health from that set (its own window). batchUsage
  // tracks in-tick dials so we spread across eligible numbers as we go.
  const now = Date.now();
  const maxWindowMin = Math.max(
    5,
    ...queue.map((c) => c.campaign?.switch_window_minutes ?? 60),
  );
  const callRows = await loadNumberCalls(
    admin,
    orgIds,
    maxWindowMin * 60 * 1000,
  );
  // Group rows per org — a number's reputation is org-wide, and tenancy must
  // never leak across orgs (Law #1).
  const rowsByOrg = new Map<string, CallRow[]>();
  for (const row of callRows) {
    const list = rowsByOrg.get(row.organisation_id) ?? [];
    list.push(row);
    rowsByOrg.set(row.organisation_id, list);
  }
  // Per-campaign health map: that org's rows filtered to the campaign's window.
  const healthByCampaign = new Map<string, Map<string, NumberHealth>>();
  for (const c of queue) {
    if (!c.campaign || healthByCampaign.has(c.campaign.id)) continue;
    healthByCampaign.set(
      c.campaign.id,
      computeNumberHealth(
        rowsByOrg.get(c.organisation_id) ?? [],
        c.campaign.switch_window_minutes * 60 * 1000,
        now,
      ),
    );
  }
  const batchUsage = new Map<string, number>();

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

      // Per-campaign overrides win; null fields fall back to the org default
      // stored on bolna_integrations.
      const resolvedAgentId =
        contact.campaign?.agent_id ?? integration.agent_id;

      // Choose the caller-ID by connect-rate health. Done BEFORE the CAS claim
      // so a contact that must be deferred (all numbers resting) doesn't burn
      // its pending state.
      const cmp = contact.campaign;
      const pick = pickHealthyNumber({
        pool: cmp?.from_phone_numbers ?? [],
        singleOverride: cmp?.from_phone_number ?? integration.from_phone_number,
        health: healthByCampaign.get(contact.campaign_id) ?? new Map(),
        batchUsage,
        floorPct: cmp?.switch_connect_rate_floor ?? 30,
        minSamples: cmp?.switch_min_samples ?? 20,
        // After a few backoff rounds, allow dialing the least-bad number so the
        // run finishes (operator chose completion over number-preservation).
        allowLeastBad: contact.health_defer_count >= MAX_HEALTH_BACKOFF_ROUNDS,
      });

      if (pick.kind === "defer") {
        // Every caller-ID is resting (connect rate below the floor). Defer with
        // escalating backoff; the next round may find a recovered number, and
        // once backoff is exhausted we'll fall back to the least-bad number.
        const round = contact.health_defer_count;
        const backoffMs = HEALTH_DEFER_BASE_MS * 2 ** round;
        await admin
          .from("campaign_contacts")
          .update({
            health_defer_count: round + 1,
            next_attempt_at: new Date(Date.now() + backoffMs).toISOString(),
            last_error: "All caller IDs resting (low connect rate) — deferred",
          })
          .eq("id", contact.id)
          .eq("status", "pending");
        return { id: contact.id, ok: false, reason: "numbers_resting" };
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

      // Normalise the sentinel: "" means "no caller-ID, let the provider pick"
      // → store NULL on the call row.
      const fromPhoneForDial: string | null = pick.number || null;

      // Count this dial in-batch so concurrent workers spread across eligible
      // numbers rather than all piling onto the single healthiest one.
      if (fromPhoneForDial) {
        batchUsage.set(
          fromPhoneForDial,
          (batchUsage.get(fromPhoneForDial) ?? 0) + 1,
        );
      }
      // Reset the all-resting backoff counter when we dial from a HEALTHY
      // number; a least-bad (degraded) dial leaves it high so we stay in
      // least-bad mode until a number actually recovers.
      const resetHealthDefer = !pick.degraded && contact.health_defer_count > 0;

      try {
        const result = await initiateBolnaCall({
          apiKey: integration.api_key,
          agentId: resolvedAgentId,
          recipientPhone: contact.phone,
          fromPhone: fromPhoneForDial,
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
            from_phone: fromPhoneForDial,
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
            ...(resetHealthDefer ? { health_defer_count: 0 } : {}),
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
          from_phone: fromPhoneForDial,
          agent_id: resolvedAgentId,
          status: "failed",
          direction: "outbound",
          error_message: reason.slice(0, 500),
        });

        const newAttempt = contact.attempt + 1;
        const cap =
          (contact.campaign?.max_attempts ?? 1) + contact.callback_count;
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
