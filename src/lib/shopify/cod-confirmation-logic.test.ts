import { describe, expect, it } from "vitest";

import {
  decideCodOutcome,
  isCodOrder,
  type DecideCodInput,
  type OrderPaymentInfo,
} from "@/lib/shopify/cod-confirmation-logic";
import type { CallStatus } from "@/types/call";

const NOW = 1_700_000_000_000;
const RETRY = 1800; // seconds

function payment(overrides: Partial<OrderPaymentInfo> = {}): OrderPaymentInfo {
  return {
    gateway: null,
    paymentGatewayNames: [],
    financialStatus: null,
    ...overrides,
  };
}

describe("isCodOrder", () => {
  it("detects COD from the gateway name via the built-in heuristic", () => {
    expect(
      isCodOrder(payment({ gateway: "Cash on Delivery (COD)" }), []),
    ).toBe(true);
    expect(
      isCodOrder(payment({ paymentGatewayNames: ["COD"] }), []),
    ).toBe(true);
    expect(
      isCodOrder(payment({ paymentGatewayNames: ["cash on delivery"] }), null),
    ).toBe(true);
  });

  it("does not match prepaid gateways under the heuristic", () => {
    expect(isCodOrder(payment({ gateway: "Razorpay" }), [])).toBe(false);
    expect(
      isCodOrder(payment({ paymentGatewayNames: ["Shopify Payments"] }), []),
    ).toBe(false);
    // "cod" must be a standalone token — not a substring of another word.
    expect(isCodOrder(payment({ gateway: "codicil pay" }), [])).toBe(false);
  });

  it("returns false when there is no gateway information", () => {
    expect(isCodOrder(payment(), [])).toBe(false);
    expect(isCodOrder(payment({ paymentGatewayNames: ["", "  "] }), [])).toBe(
      false,
    );
  });

  it("uses the org allowlist when provided (case-insensitive substring)", () => {
    // A custom label the heuristic wouldn't catch, matched by the allowlist.
    expect(
      isCodOrder(payment({ gateway: "GoKwik Pay Later" }), ["gokwik pay later"]),
    ).toBe(true);
    expect(
      isCodOrder(payment({ paymentGatewayNames: ["MyCustomCOD"] }), ["mycustom"]),
    ).toBe(true);
  });

  it("allowlist overrides the heuristic — a non-listed COD label is rejected", () => {
    // Allowlist is set but doesn't include this gateway, so it's NOT COD even
    // though the heuristic would have matched "cash on delivery".
    expect(
      isCodOrder(payment({ gateway: "Cash on Delivery" }), ["gokwik cod"]),
    ).toBe(false);
  });
});

function decide(overrides: Partial<DecideCodInput> = {}) {
  return decideCodOutcome({
    callStatus: "no_answer",
    attempt: 1,
    maxAttempts: 3,
    retryIntervalSeconds: RETRY,
    now: NOW,
    ...overrides,
  });
}

describe("decideCodOutcome", () => {
  it("ends the flow when connected — regardless of confirmed yes/no", () => {
    expect(decide({ callStatus: "completed" }).kind).toBe("reached");
    expect(decide({ callStatus: "in_progress" }).kind).toBe("reached");
  });

  it("re-arms a non-connect while under the attempt cap", () => {
    const d = decide({ callStatus: "no_answer", attempt: 1, maxAttempts: 3 });
    expect(d.kind).toBe("rearm");
    expect(d.retryAtMs).toBe(NOW + RETRY * 1000);
  });

  it.each<CallStatus>(["no_answer", "busy", "failed", "canceled"])(
    "retries the not-connected status %s",
    (status) => {
      expect(decide({ callStatus: status, attempt: 0 }).kind).toBe("rearm");
    },
  );

  it("fails a non-connect once the cap is reached", () => {
    const d = decide({ callStatus: "no_answer", attempt: 3, maxAttempts: 3 });
    expect(d.kind).toBe("fail");
    expect(d.retryAtMs).toBeNull();
  });

  it("is a no-op for non-terminal, non-connected statuses", () => {
    expect(decide({ callStatus: "ringing" }).kind).toBe("noop");
    expect(decide({ callStatus: "initiated" }).kind).toBe("noop");
  });
});
