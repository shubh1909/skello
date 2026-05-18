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
  lead_data: Record<string, unknown>;
  custom_data: Record<string, Record<string, unknown>>;
  created_at: string;
  updated_at: string;
}

export interface CallWithLead extends Call {
  lead: { name: string | null; phone: string | null } | null;
}
