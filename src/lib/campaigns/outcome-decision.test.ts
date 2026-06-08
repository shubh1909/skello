import { describe, expect, it } from "vitest";

import {
  callbackTime,
  decideOutcome,
  isTerminalCallStatus,
  type DecideOutcomeInput,
} from "@/lib/campaigns/outcome-decision";
import type { CallOutcome, CallStatus } from "@/types/call";
import type { CampaignRetryTrigger } from "@/types/campaign";

// Fixed clock so next_attempt_at is deterministic.
const NOW = 1_700_000_000_000;
const INTERVAL = 900; // seconds
const NOW_PLUS_INTERVAL = new Date(NOW + INTERVAL * 1000).toISOString();

function make(overrides: Partial<DecideOutcomeInput> = {}): DecideOutcomeInput {
  return {
    callStatus: "completed",
    callOutcome: null,
    requestedCallbackAt: null,
    callId: "call-1",
    attempt: 1,
    callbackCount: 0,
    campaign: {
      max_attempts: 3,
      max_callbacks: 2,
      retry_interval_seconds: INTERVAL,
      retry_on: ["no_answer", "busy", "failed", "canceled"],
    },
    now: NOW,
    ...overrides,
  };
}

describe("isTerminalCallStatus", () => {
  it("treats finished statuses as terminal", () => {
    for (const s of [
      "completed",
      "no_answer",
      "busy",
      "failed",
      "canceled",
    ] as CallStatus[]) {
      expect(isTerminalCallStatus(s)).toBe(true);
    }
  });

  it("treats in-progress statuses as non-terminal", () => {
    for (const s of ["initiated", "ringing", "in_progress"] as CallStatus[]) {
      expect(isTerminalCallStatus(s)).toBe(false);
    }
  });
});

describe("decideOutcome — non-terminal", () => {
  it.each(["initiated", "ringing", "in_progress"] as CallStatus[])(
    "%s → noop",
    (callStatus) => {
      expect(decideOutcome(make({ callStatus }))).toEqual({ kind: "noop" });
    },
  );
});

describe("decideOutcome — disposition tier (completed)", () => {
  it.each(["interested", "meeting_booked", "no_decision"] as CallOutcome[])(
    "%s → succeed",
    (callOutcome) => {
      const d = decideOutcome(make({ callOutcome }));
      expect(d.kind).toBe("succeed");
      expect(d).toEqual({
        kind: "succeed",
        patch: {
          last_status: "completed",
          last_call_id: "call-1",
          status: "succeeded",
          last_error: null,
          last_outcome: callOutcome,
        },
      });
    },
  );

  it("null outcome defaults to no_decision → succeed", () => {
    const d = decideOutcome(make({ callOutcome: null }));
    expect(d.kind).toBe("succeed");
    if (d.kind === "succeed") {
      expect(d.patch.last_outcome).toBe("no_decision");
    }
  });

  it("unrecognised outcome is defensively treated as success", () => {
    const d = decideOutcome(
      make({ callOutcome: "totally_unknown" as CallOutcome }),
    );
    expect(d.kind).toBe("succeed");
  });

  it.each([
    ["not_interested", "Customer not interested"],
    ["do_not_call", "Customer requested no further calls"],
    ["wrong_number", "Wrong number"],
  ] as [CallOutcome, string][])(
    "%s → fail with reason (no retry)",
    (callOutcome, reason) => {
      const d = decideOutcome(make({ callOutcome }));
      expect(d).toEqual({
        kind: "fail",
        patch: {
          last_status: "completed",
          last_call_id: "call-1",
          status: "failed",
          last_error: reason,
          last_outcome: callOutcome,
        },
      });
    },
  );

  it("do_not_call does NOT touch any global flag — it just fails this contact", () => {
    const d = decideOutcome(make({ callOutcome: "do_not_call" }));
    expect(d.kind).toBe("fail");
    // No lead-level / cross-campaign field in the patch.
    if (d.kind === "fail") {
      expect(Object.keys(d.patch).sort()).toEqual([
        "last_call_id",
        "last_error",
        "last_outcome",
        "last_status",
        "status",
      ]);
    }
  });
});

describe("decideOutcome — callback budget", () => {
  it("callback_requested with budget left → rearm at requested time, callback_count++", () => {
    const requestedCallbackAt = new Date(NOW + 7 * 24 * 3600 * 1000).toISOString();
    const d = decideOutcome(
      make({
        callOutcome: "callback_requested",
        requestedCallbackAt,
        callbackCount: 0,
      }),
    );
    expect(d).toEqual({
      kind: "rearm",
      patch: {
        last_status: "completed",
        last_call_id: "call-1",
        status: "pending",
        callback_count: 1,
        next_attempt_at: requestedCallbackAt,
        last_error: null,
        last_outcome: "callback_requested",
      },
    });
  });

  it("callback_requested with no time → falls back to retry interval", () => {
    const d = decideOutcome(
      make({ callOutcome: "callback_requested", requestedCallbackAt: null }),
    );
    if (d.kind !== "rearm") throw new Error("expected rearm");
    expect(d.patch.next_attempt_at).toBe(NOW_PLUS_INTERVAL);
  });

  it("callback_requested with a PAST time → falls back to retry interval", () => {
    const past = new Date(NOW - 1000).toISOString();
    const d = decideOutcome(
      make({ callOutcome: "callback_requested", requestedCallbackAt: past }),
    );
    if (d.kind !== "rearm") throw new Error("expected rearm");
    expect(d.patch.next_attempt_at).toBe(NOW_PLUS_INTERVAL);
  });

  it("callback_requested with a garbage time → falls back to retry interval", () => {
    const d = decideOutcome(
      make({
        callOutcome: "callback_requested",
        requestedCallbackAt: "not-a-date",
      }),
    );
    if (d.kind !== "rearm") throw new Error("expected rearm");
    expect(d.patch.next_attempt_at).toBe(NOW_PLUS_INTERVAL);
  });

  it("callback budget exhausted (count == max) → succeed, not rearm", () => {
    const d = decideOutcome(
      make({
        callOutcome: "callback_requested",
        callbackCount: 2,
        campaign: {
          max_attempts: 3,
          max_callbacks: 2,
          retry_interval_seconds: INTERVAL,
          retry_on: [],
        },
      }),
    );
    expect(d.kind).toBe("succeed");
  });

  it("max_callbacks=0 disables callbacks entirely → succeed", () => {
    const d = decideOutcome(
      make({
        callOutcome: "callback_requested",
        callbackCount: 0,
        campaign: {
          max_attempts: 3,
          max_callbacks: 0,
          retry_interval_seconds: INTERVAL,
          retry_on: [],
        },
      }),
    );
    expect(d.kind).toBe("succeed");
  });
});

describe("decideOutcome — technical tier", () => {
  it.each(["no_answer", "busy", "failed", "canceled"] as CallStatus[])(
    "%s in retry_on and under cap → rearm at retry interval",
    (callStatus) => {
      const d = decideOutcome(make({ callStatus, attempt: 1 }));
      expect(d).toEqual({
        kind: "rearm",
        patch: {
          last_status: callStatus,
          last_call_id: "call-1",
          status: "pending",
          next_attempt_at: NOW_PLUS_INTERVAL,
        },
      });
    },
  );

  it("technical rearm patch carries NO disposition fields", () => {
    const d = decideOutcome(make({ callStatus: "no_answer", attempt: 0 }));
    if (d.kind !== "rearm") throw new Error("expected rearm");
    expect(d.patch).not.toHaveProperty("last_outcome");
    expect(d.patch).not.toHaveProperty("last_error");
    expect(d.patch).not.toHaveProperty("callback_count");
  });

  it("status not in retry_on → fail (no retry)", () => {
    const d = decideOutcome(
      make({
        callStatus: "busy",
        attempt: 0,
        campaign: {
          max_attempts: 3,
          max_callbacks: 2,
          retry_interval_seconds: INTERVAL,
          retry_on: ["no_answer"], // busy excluded
        },
      }),
    );
    expect(d).toEqual({
      kind: "fail",
      patch: {
        last_status: "busy",
        last_call_id: "call-1",
        status: "failed",
      },
    });
  });

  it("retryable but cap hit (attempt >= max_attempts) → fail", () => {
    const d = decideOutcome(
      make({ callStatus: "no_answer", attempt: 3 }), // 3 >= 3 + 0
    );
    expect(d.kind).toBe("fail");
  });

  it("honored callbacks extend the dial cap (attempt < max_attempts + callback_count)", () => {
    // attempt 3, max_attempts 3 → would be capped, but callback_count 1 lifts
    // the cap to 4, so this is still retryable.
    const d = decideOutcome(
      make({ callStatus: "no_answer", attempt: 3, callbackCount: 1 }),
    );
    expect(d.kind).toBe("rearm");
  });

  it("technical fail patch has only the base fields + status", () => {
    const d = decideOutcome(make({ callStatus: "failed", attempt: 99 }));
    if (d.kind !== "fail") throw new Error("expected fail");
    expect(Object.keys(d.patch).sort()).toEqual([
      "last_call_id",
      "last_status",
      "status",
    ]);
  });
});

describe("callbackTime", () => {
  it("returns the requested time when it is in the future", () => {
    const future = new Date(NOW + 5000).toISOString();
    expect(callbackTime(future, INTERVAL, NOW)).toBe(future);
  });

  it("falls back to now + interval when null/past/invalid", () => {
    expect(callbackTime(null, INTERVAL, NOW)).toBe(NOW_PLUS_INTERVAL);
    expect(callbackTime(new Date(NOW - 1).toISOString(), INTERVAL, NOW)).toBe(
      NOW_PLUS_INTERVAL,
    );
    expect(callbackTime("garbage", INTERVAL, NOW)).toBe(NOW_PLUS_INTERVAL);
  });
});

// Type-only guard: keep the retry-trigger union and the test list in sync.
const _allTriggers: CampaignRetryTrigger[] = [
  "no_answer",
  "busy",
  "failed",
  "canceled",
];
void _allTriggers;
