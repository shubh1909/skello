import { describe, expect, it } from "vitest";

import {
  decideCallbackOutcome,
  isTerminalCallStatus,
  type DecideCallbackInput,
} from "@/lib/callbacks/outcome-decision";
import type { CallStatus } from "@/types/call";

// Fixed clock so next_attempt_at is deterministic.
const NOW = 1_700_000_000_000;
const INTERVAL = 900; // seconds
const NOW_PLUS_INTERVAL = new Date(NOW + INTERVAL * 1000).toISOString();

function make(
  overrides: Partial<DecideCallbackInput> = {},
): DecideCallbackInput {
  return {
    callStatus: "completed",
    callId: "call-1",
    attempt: 1,
    maxAttempts: 3,
    retryIntervalSeconds: INTERVAL,
    now: NOW,
    ...overrides,
  };
}

describe("decideCallbackOutcome", () => {
  it("ignores non-terminal statuses", () => {
    for (const s of ["initiated", "ringing", "in_progress"] as CallStatus[]) {
      expect(decideCallbackOutcome(make({ callStatus: s }))).toEqual({
        kind: "noop",
      });
    }
  });

  it("succeeds on a completed call regardless of how many attempts it took", () => {
    const decision = decideCallbackOutcome(
      make({ callStatus: "completed", attempt: 2 }),
    );
    expect(decision.kind).toBe("succeed");
    if (decision.kind !== "succeed") return;
    expect(decision.patch).toMatchObject({
      status: "succeeded",
      last_status: "completed",
      last_call_id: "call-1",
      last_error: null,
    });
  });

  it("re-arms a retryable technical failure while under the attempt cap", () => {
    for (const s of ["no_answer", "busy", "failed"] as CallStatus[]) {
      const decision = decideCallbackOutcome(
        make({ callStatus: s, attempt: 1, maxAttempts: 3 }),
      );
      expect(decision.kind).toBe("rearm");
      if (decision.kind !== "rearm") return;
      expect(decision.patch).toMatchObject({
        status: "pending",
        last_status: s,
        next_attempt_at: NOW_PLUS_INTERVAL,
      });
    }
  });

  it("fails a retryable status once the attempt cap is reached", () => {
    const decision = decideCallbackOutcome(
      make({ callStatus: "no_answer", attempt: 3, maxAttempts: 3 }),
    );
    expect(decision.kind).toBe("fail");
    if (decision.kind !== "fail") return;
    expect(decision.patch).toMatchObject({ status: "failed" });
    expect(decision.patch.last_error).toBe("Retries exhausted (no_answer)");
  });

  it("treats attempt === maxAttempts as the boundary (no further re-arm)", () => {
    // attempt 2 of 3 → still re-arms; attempt 3 of 3 → fails.
    expect(
      decideCallbackOutcome(make({ callStatus: "busy", attempt: 2, maxAttempts: 3 }))
        .kind,
    ).toBe("rearm");
    expect(
      decideCallbackOutcome(make({ callStatus: "busy", attempt: 3, maxAttempts: 3 }))
        .kind,
    ).toBe("fail");
  });

  it("fails a non-retryable terminal status (canceled) without retrying", () => {
    const decision = decideCallbackOutcome(
      make({ callStatus: "canceled", attempt: 1, maxAttempts: 3 }),
    );
    expect(decision.kind).toBe("fail");
    if (decision.kind !== "fail") return;
    expect(decision.patch.last_error).toBe("Terminal: canceled");
  });

  it("always stamps the triggering call id and status for traceability", () => {
    const decision = decideCallbackOutcome(
      make({ callStatus: "failed", callId: "call-xyz", attempt: 1 }),
    );
    expect(decision.kind).not.toBe("noop");
    if (decision.kind === "noop") return;
    expect(decision.patch).toMatchObject({
      last_call_id: "call-xyz",
      last_status: "failed",
    });
  });
});

describe("isTerminalCallStatus (re-exported)", () => {
  it("marks finished statuses terminal and in-flight ones not", () => {
    for (const s of [
      "completed",
      "no_answer",
      "busy",
      "failed",
      "canceled",
    ] as CallStatus[]) {
      expect(isTerminalCallStatus(s)).toBe(true);
    }
    for (const s of ["initiated", "ringing", "in_progress"] as CallStatus[]) {
      expect(isTerminalCallStatus(s)).toBe(false);
    }
  });
});
