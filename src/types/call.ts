import type { LeadIntent } from "./lead";

export type CallStatus =
  | "initiated"
  | "ringing"
  | "in_progress"
  | "completed"
  | "failed"
  | "no_answer"
  | "busy"
  | "canceled";

export type CallDirection = "inbound" | "outbound";

// Semantic disposition of the conversation — what the customer actually wanted,
// distinct from the technical CallStatus. Extracted by the voice agent and used
// to drive disposition-based campaign retry.
//
// Outcomes are now PER-ORG configurable (see org_outcome_policies), so the type
// is an open string (the normalised key the agent emits). KNOWN_CALL_OUTCOMES
// lists the seeded defaults — used for alias normalisation and as sensible
// suggestions in the admin UI — but an org may add its own.
export type CallOutcome = string;

export const KNOWN_CALL_OUTCOMES = [
  "interested",
  "meeting_booked",
  "not_interested",
  "callback_requested",
  "do_not_call",
  "wrong_number",
  "no_decision",
] as const;

export type CallTranscriptStatus =
  | "pending"
  | "processing"
  | "ready"
  | "failed"
  | "skipped";

export interface Call {
  id: string;
  organisation_id: string;
  lead_id: string | null;
  initiated_by: string | null;
  bolna_call_id: string | null;
  to_phone: string | null;
  from_phone: string | null;
  agent_id: string;
  status: CallStatus;
  direction: CallDirection;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  transcript_url: string | null;
  transcript: string | null;
  transcript_status: CallTranscriptStatus;
  transcript_fetched_at: string | null;
  language: string | null;
  summary: string | null;
  // Per-conversation snapshots of extracted fields (immutable per call).
  name_extracted: string | null;
  interest: string | null;
  lead_intent_extracted: LeadIntent | null;
  actionable: string | null;
  customer_status: string | null;
  visit_scheduled_at: string | null;
  connect_on_whatsapp: boolean | null;
  // Semantic disposition extracted from this conversation, and the time the
  // customer asked to be re-called (only set when call_outcome is
  // callback_requested). Both drive disposition-based campaign retry.
  call_outcome: CallOutcome | null;
  requested_callback_at: string | null;
  lead_data: Record<string, unknown>;
  custom_data: Record<string, Record<string, unknown>>;
  // True when the row came from the Campaigns > Test Call dialog. The
  // outbound webhook skips lead-merge for these rows and lifetime stat
  // cards exclude them so demo dials don't pollute real metrics.
  is_test: boolean;
  created_at: string;
  updated_at: string;
}

export interface CallWithLead extends Call {
  lead: { name: string | null; phone: string | null } | null;
  // Highest-priority disposition this call's campaign contact reached across all
  // its attempts, per the org's outcome priority order (top priorities only).
  // Only populated for campaign-scoped lists; null = nothing notable. Derived on
  // read — not a stored column.
  best_outcome?: string | null;
}
