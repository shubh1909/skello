import type { CallDirection, CallStatus } from "@/types/call";

// Shared filter shape used by both the in-app conversations listing and the
// CSV export route. The page lives in callListSchema (Zod) and on the
// /api/calls/export query string; both shapes map onto this contract.
export interface CallFilterInput {
  lead_id?: string;
  status?: CallStatus;
  direction?: CallDirection;
  agent_id?: string;
  from?: string;
  to?: string;
  q?: string;
}

// PostgREST .or() uses commas as separators and percent for ilike wildcards.
// Stripping both keeps the OR clause un-injectable even when the search box
// is fed user-controlled data.
export function escapeForOrFilter(input: string): string {
  return input.replace(/[%,]/g, " ").trim();
}

// Applies the conversations-table filter set to a Supabase query builder.
// Generic so the caller's specific builder type (.select shape, .returns<T>,
// etc.) flows through unchanged — the helper just narrows the WHERE clause.
//
// Why this lives in lib/ rather than actions/: the CSV export route is a
// REST handler, not a Server Action, and reaches for the same WHERE
// clauses. Co-locating them prevents the two paths from drifting.
export function applyCallFilters<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Q extends Record<string, any>,
>(query: Q, f: CallFilterInput): Q {
  let q = query;
  if (f.lead_id) q = q.eq("lead_id", f.lead_id);
  if (f.status) q = q.eq("status", f.status);
  if (f.direction) q = q.eq("direction", f.direction);
  if (f.agent_id) q = q.eq("agent_id", f.agent_id);
  if (f.from) q = q.gte("started_at", f.from);
  if (f.to) q = q.lte("started_at", f.to);
  if (f.q && f.q.trim().length > 0) {
    const safe = escapeForOrFilter(f.q);
    if (safe.length > 0) {
      q = q.or(
        `to_phone.ilike.%${safe}%,from_phone.ilike.%${safe}%,bolna_call_id.ilike.%${safe}%`,
      );
    }
  }
  return q;
}
