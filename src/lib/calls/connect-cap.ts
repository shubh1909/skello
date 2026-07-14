import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

// Default per-org ceiling on how many times a single lead (dialled phone) may be
// SUCCESSFULLY CONNECTED to across every outbound calling surface (recovery,
// campaigns, scheduled callbacks) within the rolling window. Overridable per org
// via bolna_integrations.max_connected_calls_per_lead (NULL → unlimited).
export const DEFAULT_MAX_CONNECTED_CALLS_PER_LEAD = 2;

// Rolling window the cap is measured over. A connect ages out of the count 48h
// after it happened, so a capped lead becomes callable again on its own — no
// reset job needed, it's just a moving lower bound on `started_at`.
export const CONNECTED_CALL_CAP_WINDOW_MS = 48 * 60 * 60 * 1000;

// "Connected" mirrors applyShopifyRecoveryOutcome: the shopper actually picked
// up. `in_progress` (answered, still talking) and `completed` (answered, hung
// up) both count; ringing / no_answer / busy / failed / canceled do not.
const CONNECTED_STATUSES = ["in_progress", "completed"];

// Resolve the per-org cap. A NULL column means the org opted out → unlimited.
export function resolveConnectedCallCap(
  maxConnectedCallsPerLead: number | null | undefined,
): number {
  if (maxConnectedCallsPerLead == null) return Number.POSITIVE_INFINITY;
  return maxConnectedCallsPerLead;
}

export interface ConnectedCapResult {
  // Phones (exactly as passed in) at or over the cap — do not dial these.
  capped: Set<string>;
  // For each capped phone, the instant it becomes callable again: its earliest
  // in-window connect + the window. Absent for uncapped phones.
  reEligibleAt: Map<string, string>;
}

/**
 * For one org, decide which of the given phones are already at/over the
 * connected-call cap in the rolling window, and when each frees up. Counts
 * connected OUTBOUND, non-test calls to that exact phone.
 *
 * An unlimited cap (Infinity) short-circuits to an empty result — no query.
 */
export async function evaluateConnectedCallCap(input: {
  admin: Admin;
  organisationId: string;
  phones: string[];
  cap: number;
  now?: number;
}): Promise<ConnectedCapResult> {
  const empty: ConnectedCapResult = {
    capped: new Set(),
    reEligibleAt: new Map(),
  };
  if (!Number.isFinite(input.cap)) return empty;

  const phones = Array.from(new Set(input.phones.filter(Boolean)));
  if (phones.length === 0) return empty;

  const now = input.now ?? Date.now();
  const since = new Date(now - CONNECTED_CALL_CAP_WINDOW_MS).toISOString();

  const { data } = await input.admin
    .from("calls")
    .select("to_phone, started_at")
    .eq("organisation_id", input.organisationId)
    .eq("direction", "outbound")
    .eq("is_test", false)
    .in("status", CONNECTED_STATUSES)
    .in("to_phone", phones)
    .gte("started_at", since)
    .returns<Array<{ to_phone: string | null; started_at: string }>>();

  // Tally connects + earliest connect (in ms, to avoid lexical tz comparison).
  const counts = new Map<string, number>();
  const earliestMs = new Map<string, number>();
  for (const row of data ?? []) {
    if (!row.to_phone) continue;
    counts.set(row.to_phone, (counts.get(row.to_phone) ?? 0) + 1);
    const ms = new Date(row.started_at).getTime();
    const prev = earliestMs.get(row.to_phone);
    if (prev === undefined || ms < prev) earliestMs.set(row.to_phone, ms);
  }

  const capped = new Set<string>();
  const reEligibleAt = new Map<string, string>();
  for (const phone of phones) {
    if ((counts.get(phone) ?? 0) < input.cap) continue;
    capped.add(phone);
    const first = earliestMs.get(phone);
    if (first !== undefined) {
      reEligibleAt.set(
        phone,
        new Date(first + CONNECTED_CALL_CAP_WINDOW_MS).toISOString(),
      );
    }
  }
  return { capped, reEligibleAt };
}

// Lookup surface returned by evaluateConnectedCallCapForRows — hides the
// per-org grouping from callers so a dispatcher just asks "is this row capped?".
export interface CappedEval {
  isCapped(orgId: string, phone: string | null): boolean;
  // ISO instant the (orgId, phone) frees up, or null when unknown.
  reEligibleAt(orgId: string, phone: string): string | null;
}

/**
 * Evaluate the connected-call cap for a batch of rows spanning one or more
 * orgs (a dispatch tick's queue). Groups phones per org, runs one count query
 * per org in parallel, and returns a flat lookup.
 *
 * `capForOrg` resolves the ceiling for an org — callers pass the org's
 * bolna_integrations value through resolveConnectedCallCap (falling back to
 * DEFAULT_MAX_CONNECTED_CALLS_PER_LEAD when the integration row is absent).
 */
export async function evaluateConnectedCallCapForRows(input: {
  admin: Admin;
  rows: Array<{ organisation_id: string; phone: string | null }>;
  capForOrg: (orgId: string) => number;
  now?: number;
}): Promise<CappedEval> {
  const phonesByOrg = new Map<string, Set<string>>();
  for (const r of input.rows) {
    if (!r.phone) continue;
    const set = phonesByOrg.get(r.organisation_id) ?? new Set<string>();
    set.add(r.phone);
    phonesByOrg.set(r.organisation_id, set);
  }

  const resultByOrg = new Map<string, ConnectedCapResult>();
  await Promise.all(
    Array.from(phonesByOrg.entries()).map(async ([orgId, phones]) => {
      const res = await evaluateConnectedCallCap({
        admin: input.admin,
        organisationId: orgId,
        phones: Array.from(phones),
        cap: input.capForOrg(orgId),
        now: input.now,
      });
      resultByOrg.set(orgId, res);
    }),
  );

  return {
    isCapped: (orgId, phone) =>
      !!phone && !!resultByOrg.get(orgId)?.capped.has(phone),
    reEligibleAt: (orgId, phone) =>
      resultByOrg.get(orgId)?.reEligibleAt.get(phone) ?? null,
  };
}
