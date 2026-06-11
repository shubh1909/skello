import type { CallOutcome, CallStatus } from "@/types/call";
import type { CampaignRetryTrigger } from "@/types/campaign";
import {
  FALLBACK_OUTCOME_KEY,
  type ResolvedOutcomePolicy,
} from "@/types/outcome-policy";

// Pure decision core for the campaign-contact state machine. No I/O — given a
// finished call + the contact's counters + the campaign's retry config + the
// org's outcome policy, it returns WHAT should happen and the exact column
// patch. The async applier (outcome.ts) does the DB reads/writes and the lead
// conversion. Keeping this pure makes the whole decision table unit-testable
// with zero mocks.

const RETRY_ELIGIBLE: ReadonlySet<CallStatus> = new Set<CallStatus>([
  "no_answer",
  "busy",
  "failed",
  "canceled",
]);

const TERMINAL_STATUSES: ReadonlySet<CallStatus> = new Set<CallStatus>([
  "completed",
  "no_answer",
  "busy",
  "failed",
  "canceled",
]);

export function isTerminalCallStatus(status: CallStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export interface DecideOutcomeInput {
  callStatus: CallStatus;
  callOutcome: CallOutcome | null;
  requestedCallbackAt: string | null;
  callId: string;
  // Contact counters.
  attempt: number;
  callbackCount: number;
  campaign: {
    max_attempts: number;
    max_callbacks: number;
    retry_interval_seconds: number;
    retry_on: CampaignRetryTrigger[];
  };
  // The org's resolved outcome policy: per-key action + fallback action for any
  // label not in the org's configured set.
  policy: ResolvedOutcomePolicy;
  // Injected clock (ms). Pass Date.now() in production; a fixed value in tests.
  now: number;
}

// The applier injects `lead_id` on a `succeed` (it's an I/O lookup); every
// other field of every patch is decided here.
export type OutcomeDecision =
  | { kind: "noop" }
  | { kind: "succeed"; patch: Record<string, unknown> }
  | { kind: "fail"; patch: Record<string, unknown> }
  | { kind: "rearm"; patch: Record<string, unknown> };

export function decideOutcome(input: DecideOutcomeInput): OutcomeDecision {
  const { callStatus, callId, attempt, callbackCount, campaign, policy, now } =
    input;

  if (!TERMINAL_STATUSES.has(callStatus)) return { kind: "noop" };

  const basePatch = { last_status: callStatus, last_call_id: callId };

  // ---- Disposition tier (completed calls only) ----------------------------
  if (callStatus === "completed") {
    // Record the actual key the agent emitted (or the reserved fallback when
    // none was extracted) so stats can map it back to the policy. Resolve the
    // ACTION via the policy, falling back for any unconfigured key.
    const outcomeKey = input.callOutcome ?? FALLBACK_OUTCOME_KEY;
    const action = policy.actions[outcomeKey] ?? policy.fallbackAction;

    if (action === "callback") {
      if (callbackCount < campaign.max_callbacks) {
        return {
          kind: "rearm",
          patch: {
            ...basePatch,
            status: "pending",
            callback_count: callbackCount + 1,
            next_attempt_at: callbackTime(
              input.requestedCallbackAt,
              campaign.retry_interval_seconds,
              now,
            ),
            last_error: null,
            last_outcome: outcomeKey,
          },
        };
      }
      // Engaged customer, but we've honored as many callbacks as allowed —
      // close as a success rather than re-dial indefinitely.
      return succeedDecision(basePatch, outcomeKey);
    }

    if (action === "retry") {
      // Disposition-driven retry: re-dial at the standard interval if we're
      // still under the dial allowance, otherwise it's terminal.
      const capHit = attempt >= campaign.max_attempts + callbackCount;
      if (!capHit) {
        return {
          kind: "rearm",
          patch: {
            ...basePatch,
            status: "pending",
            next_attempt_at: new Date(
              now + campaign.retry_interval_seconds * 1000,
            ).toISOString(),
            last_error: null,
            last_outcome: outcomeKey,
          },
        };
      }
      return {
        kind: "fail",
        patch: {
          ...basePatch,
          status: "failed",
          last_error: `Retries exhausted (${outcomeKey})`,
          last_outcome: outcomeKey,
        },
      };
    }

    if (action === "fail") {
      return {
        kind: "fail",
        patch: {
          ...basePatch,
          status: "failed",
          last_error: `Outcome: ${outcomeKey}`,
          last_outcome: outcomeKey,
        },
      };
    }

    // action === "succeed" (and, defensively, any unexpected value) so a
    // connected call never silently stalls in_flight.
    return succeedDecision(basePatch, outcomeKey);
  }

  // ---- Technical tier (no_answer / busy / failed / canceled) --------------
  const isRetryable =
    campaign.retry_on.includes(callStatus as CampaignRetryTrigger) &&
    RETRY_ELIGIBLE.has(callStatus);

  // Honored callbacks extend the dial allowance on top of the technical cap.
  const capHit = attempt >= campaign.max_attempts + callbackCount;

  if (isRetryable && !capHit) {
    return {
      kind: "rearm",
      patch: {
        ...basePatch,
        status: "pending",
        next_attempt_at: new Date(
          now + campaign.retry_interval_seconds * 1000,
        ).toISOString(),
      },
    };
  }

  return { kind: "fail", patch: { ...basePatch, status: "failed" } };
}

function succeedDecision(
  basePatch: { last_status: CallStatus; last_call_id: string },
  outcomeKey: string,
): OutcomeDecision {
  return {
    kind: "succeed",
    patch: {
      ...basePatch,
      status: "succeeded",
      last_error: null,
      last_outcome: outcomeKey,
    },
  };
}

// Resolve the next-attempt time for a requested callback: honour the customer's
// time when it's a valid future instant, otherwise fall back to the campaign's
// standard retry interval so a vague "later" still gets re-dialed.
export function callbackTime(
  requestedCallbackAt: string | null,
  retryIntervalSeconds: number,
  now: number,
): string {
  const fallback = new Date(now + retryIntervalSeconds * 1000).toISOString();
  if (!requestedCallbackAt) return fallback;
  const t = new Date(requestedCallbackAt);
  if (Number.isNaN(t.getTime())) return fallback;
  return t.getTime() > now ? t.toISOString() : fallback;
}
