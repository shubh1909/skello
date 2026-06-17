import "server-only";

import {
  decideCallbackOutcome,
  isTerminalCallStatus,
} from "@/lib/callbacks/outcome-decision";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CallOutcome, CallStatus } from "@/types/call";

interface ApplyCallbackOutcomeInput {
  callbackId: string;
  callId: string;
  callStatus: CallStatus;
  // Disposition is available only on the final extracted webhook; the
  // status-only path omits it. v1 doesn't act on the callback's own disposition
  // (reaching the customer ends it regardless of what they then said), so it's
  // recorded for visibility but not used to branch.
  callOutcome?: CallOutcome | null;
}

interface CallbackRow {
  id: string;
  organisation_id: string;
  status: string;
  attempt: number;
  max_attempts: number;
  retry_interval_seconds: number;
}

/**
 * Advance a scheduled callback after its outbound dial reaches a terminal
 * state. The standalone analog of {@link applyCampaignContactOutcome}, but with
 * a deliberately simpler state machine — a callback is "dial once, with
 * technical retries":
 *
 *   - completed (we reached them)        → succeeded
 *   - no_answer / busy / failed, under cap → re-arm (pending, +retry_interval)
 *   - retry exhausted, or canceled        → failed
 *
 * We intentionally do NOT feed this through the campaign `decideOutcome` table:
 * that engine is shaped around campaign counters (max_callbacks, retry_on,
 * shared dial budget) which don't apply to a one-shot callback. Forcing the fit
 * would be more code and less clarity. The shared piece that DOES matter — "did
 * the inbound outcome ask for a callback at all" — is resolved once, upstream,
 * via the org's outcome policy in the scheduler.
 *
 * Idempotent: every write is guarded by `.eq('status','in_flight')`, so a
 * duplicate/late webhook for an already-finalised callback is a no-op.
 */
export async function applyScheduledCallbackOutcome({
  callbackId,
  callId,
  callStatus,
  callOutcome = null,
}: ApplyCallbackOutcomeInput): Promise<void> {
  if (!isTerminalCallStatus(callStatus)) return;

  const admin = createAdminClient();

  const { data: cb } = await admin
    .from("scheduled_callbacks")
    .select("id, organisation_id, status, attempt, max_attempts, retry_interval_seconds")
    .eq("id", callbackId)
    .maybeSingle<CallbackRow>();

  if (!cb || cb.status !== "in_flight") return;

  const decision = decideCallbackOutcome({
    callStatus,
    callId,
    attempt: cb.attempt, // already incremented at dial time
    maxAttempts: cb.max_attempts,
    retryIntervalSeconds: cb.retry_interval_seconds,
    now: Date.now(),
  });

  if (decision.kind === "noop") return;

  // One write for every kind. `last_outcome` is informational (the decision
  // doesn't branch on it in v1), so the applier adds it here.
  await admin
    .from("scheduled_callbacks")
    .update({ ...decision.patch, last_outcome: callOutcome })
    .eq("id", cb.id)
    .eq("status", "in_flight");
}
