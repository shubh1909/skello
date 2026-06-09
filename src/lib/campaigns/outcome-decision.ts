import type { CallOutcome, CallStatus } from "@/types/call";
import type { CampaignRetryTrigger } from "@/types/campaign";

// Pure decision core for the campaign-contact state machine. No I/O — given a
// finished call + the contact's counters + the campaign's retry config, it
// returns WHAT should happen and the exact column patch. The async applier
// (outcome.ts) does the DB reads/writes and the lead conversion. Keeping this
// pure makes the whole decision table unit-testable with zero mocks.

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

// Dispositions that close the contact as a SUCCESS (we reached the customer and
// had a meaningful conversation) and convert it to a lead.
const SUCCESS_OUTCOMES: ReadonlySet<CallOutcome> = new Set<CallOutcome>([
  "interested",
  "meeting_booked",
  "no_decision",
]);

// Dispositions that close the contact WITHOUT a retry — the customer's answer
// was definitive, re-dialing would only annoy them. Mapped to a human reason.
const CLOSING_OUTCOMES: Record<string, string> = {
  not_interested: "Customer not interested",
  do_not_call: "Customer requested no further calls",
  wrong_number: "Wrong number",
};

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
  const { callStatus, callId, attempt, callbackCount, campaign, now } = input;

  if (!TERMINAL_STATUSES.has(callStatus)) return { kind: "noop" };

  const basePatch = { last_status: callStatus, last_call_id: callId };

  // ---- Disposition tier (completed calls only) ----------------------------
  if (callStatus === "completed") {
    const outcome = input.callOutcome ?? "no_decision";

    if (outcome === "callback_requested") {
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
            last_outcome: outcome,
          },
        };
      }
      // Engaged customer, but we've honored as many callbacks as allowed —
      // close as a success rather than re-dial indefinitely.
      return succeedDecision(basePatch, outcome);
    }

    const closeReason = CLOSING_OUTCOMES[outcome];
    if (closeReason) {
      return {
        kind: "fail",
        patch: {
          ...basePatch,
          status: "failed",
          last_error: closeReason,
          last_outcome: outcome,
        },
      };
    }

    // interested / meeting_booked / no_decision → success. Any outcome we
    // didn't enumerate also falls here so a connected call never silently
    // stalls in_flight.
    if (SUCCESS_OUTCOMES.has(outcome)) return succeedDecision(basePatch, outcome);
    return succeedDecision(basePatch, outcome);
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
  outcome: CallOutcome,
): OutcomeDecision {
  return {
    kind: "succeed",
    patch: {
      ...basePatch,
      status: "succeeded",
      last_error: null,
      last_outcome: outcome,
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
