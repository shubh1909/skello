import { isTerminalCallStatus } from "@/lib/campaigns/outcome-decision";
import type { CallStatus } from "@/types/call";
import { CALLBACK_RETRY_ON } from "@/types/scheduled-callback";

// Pure decision core for a scheduled callback's own dial result. No I/O — given
// the finished call's status + the callback's counters, it returns WHAT should
// happen and the exact column patch. The async applier (outcome.ts) does the DB
// read/write. Keeping this pure makes the state machine unit-testable with zero
// mocks — the same split campaigns use for decideOutcome.
//
// Deliberately simpler than the campaign decision table: a callback is "dial
// once, with technical retries". It does NOT branch on the callback's own
// disposition — reaching the customer (a `completed` call) ends it regardless
// of what they then said, which keeps callbacks from looping forever.

export { isTerminalCallStatus };

export interface DecideCallbackInput {
  callStatus: CallStatus;
  callId: string;
  // Dials made so far (already incremented at dial time before the result lands).
  attempt: number;
  maxAttempts: number;
  retryIntervalSeconds: number;
  // Injected clock (ms). Pass Date.now() in production; a fixed value in tests.
  now: number;
}

export type CallbackDecision =
  | { kind: "noop" }
  | { kind: "succeed"; patch: Record<string, unknown> }
  | { kind: "fail"; patch: Record<string, unknown> }
  | { kind: "rearm"; patch: Record<string, unknown> };

export function decideCallbackOutcome(
  input: DecideCallbackInput,
): CallbackDecision {
  const { callStatus, callId, attempt, maxAttempts, retryIntervalSeconds, now } =
    input;

  // Non-terminal statuses carry no verdict yet.
  if (!isTerminalCallStatus(callStatus)) return { kind: "noop" };

  const basePatch = { last_status: callStatus, last_call_id: callId };

  // Reached the customer — done, whatever they then said.
  if (callStatus === "completed") {
    return {
      kind: "succeed",
      patch: { ...basePatch, status: "succeeded", last_error: null },
    };
  }

  // Technical failure — re-arm if retryable and under the attempt cap.
  const retryable = CALLBACK_RETRY_ON.has(callStatus);
  if (retryable && attempt < maxAttempts) {
    return {
      kind: "rearm",
      patch: {
        ...basePatch,
        status: "pending",
        next_attempt_at: new Date(
          now + retryIntervalSeconds * 1000,
        ).toISOString(),
        last_error: `Retrying after ${callStatus}`,
      },
    };
  }

  return {
    kind: "fail",
    patch: {
      ...basePatch,
      status: "failed",
      last_error: retryable
        ? `Retries exhausted (${callStatus})`
        : `Terminal: ${callStatus}`,
    },
  };
}
