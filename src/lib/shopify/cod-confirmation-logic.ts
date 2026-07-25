// Pure decision core for COD order confirmation. No I/O and no server-only, so
// both the COD-detection predicate and the dial-outcome state machine are
// unit-testable with zero mocks — the same split cart recovery / campaigns use.

import { isTerminalCallStatus } from "@/lib/campaigns/outcome-decision";
import type { CallStatus } from "@/types/call";

// The word "cod" as a standalone token, or the phrase "cash on delivery", in a
// gateway name. Bounded so it doesn't match "codicil" or a product SKU that
// happens to contain the letters. Used only when the org has no explicit
// gateway allowlist configured.
const DEFAULT_COD_PATTERN = /cash on delivery|(?:^|[^a-z])cod(?:[^a-z]|$)/;

export interface OrderPaymentInfo {
  // The order's primary `gateway` string, if present.
  gateway: string | null;
  // `payment_gateway_names` — Shopify's array of gateway labels on the order.
  paymentGatewayNames: string[];
  // `financial_status` (e.g. "pending" for COD). Captured for storage/debug;
  // NOT used for detection (gateway names are the reliable signal).
  financialStatus: string | null;
}

/**
 * Decide whether an order was paid Cash-on-Delivery, from its gateway labels.
 *
 * When `allowlist` is non-empty, an order is COD if any of its gateway strings
 * contains (case-insensitively) any allowlist entry — merchants configure the
 * exact label their gateway reports (e.g. a GoKwik COD variant). When the
 * allowlist is empty, fall back to a built-in heuristic that matches
 * "cash on delivery" or the standalone word "cod".
 *
 * Pure: no I/O, so it is unit-tested directly.
 */
export function isCodOrder(
  info: OrderPaymentInfo,
  allowlist: readonly string[] | null | undefined,
): boolean {
  const candidates = [info.gateway, ...(info.paymentGatewayNames ?? [])]
    .filter((s): s is string => typeof s === "string" && s.trim() !== "")
    .map((s) => s.toLowerCase());
  if (candidates.length === 0) return false;

  const list = (allowlist ?? [])
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== "");

  if (list.length > 0) {
    return candidates.some((c) => list.some((entry) => c.includes(entry)));
  }
  return candidates.some((c) => DEFAULT_COD_PATTERN.test(c));
}

// The verdict for a finished COD confirmation dial. `reached` = we connected and
// should record the disposition + close the flow; `rearm` = a non-connect under
// the cap, retry; `fail` = a non-connect at the cap; `noop` = no terminal verdict
// yet (ringing / initiated).
export type CodOutcomeKind = "noop" | "reached" | "rearm" | "fail";

export interface CodOutcomeDecision {
  kind: CodOutcomeKind;
  // Only for `rearm`: the ms instant to retry at, BEFORE the caller clamps it
  // into the org's calling window.
  retryAtMs: number | null;
}

export interface DecideCodInput {
  callStatus: CallStatus;
  // Dials made so far (already incremented at dial time, before this result).
  attempt: number;
  maxAttempts: number;
  retryIntervalSeconds: number;
  // Injected clock (ms). Date.now() in production; a fixed value in tests.
  now: number;
}

/**
 * COD confirmation retry rule: re-dial ONLY when the call did not connect, up to
 * `maxAttempts`. Reaching the customer once — `in_progress` (answered) or
 * `completed` — ends the flow regardless of whether they confirmed or declined
 * (a human decision, never a reason to call back). This mirrors
 * applyShopifyRecoveryOutcome's connectivity gate.
 */
export function decideCodOutcome(input: DecideCodInput): CodOutcomeDecision {
  const { callStatus, attempt, maxAttempts, retryIntervalSeconds, now } = input;

  const connected =
    callStatus === "in_progress" || callStatus === "completed";
  if (connected) return { kind: "reached", retryAtMs: null };

  // Not connected: only a terminal non-connect (no_answer / busy / failed /
  // canceled) carries a retry verdict. ringing / initiated carry none.
  if (!isTerminalCallStatus(callStatus)) return { kind: "noop", retryAtMs: null };

  if (attempt < maxAttempts) {
    return { kind: "rearm", retryAtMs: now + retryIntervalSeconds * 1000 };
  }
  return { kind: "fail", retryAtMs: null };
}
