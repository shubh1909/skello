// What a configured outcome makes a campaign contact do.
//   succeed  → terminal success (+ lead conversion)
//   fail     → terminal, no retry
//   callback → re-arm at the customer's requested time, governed by max_callbacks
//   retry    → re-arm at the campaign's standard retry interval (attempt cap)
export type OutcomeAction = "succeed" | "fail" | "callback" | "retry";

export const OUTCOME_ACTIONS: readonly OutcomeAction[] = [
  "succeed",
  "fail",
  "callback",
  "retry",
];

// One admin-configured outcome for an org. `outcome_key` is the normalised
// label the voice agent must emit; `is_fallback` marks the single reserved
// `no_decision` row used when the agent emits an unconfigured label.
export interface OutcomePolicy {
  id: string;
  organisation_id: string;
  outcome_key: string;
  label: string;
  action: OutcomeAction;
  counts_as_success: boolean;
  position: number;
  is_fallback: boolean;
  created_at: string;
  updated_at: string;
}

// The slice of policy the pure decision core needs: per-key action + the
// fallback action for unconfigured labels. Built from OutcomePolicy[] by the
// applier and passed into decideOutcome (keeps that function pure/testable).
export interface ResolvedOutcomePolicy {
  actions: Record<string, OutcomeAction>;
  fallbackAction: OutcomeAction;
}

// The reserved fallback key. Always present (seeded, non-deletable) and used
// when the agent emits a label not in the org's configured set.
export const FALLBACK_OUTCOME_KEY = "no_decision";
