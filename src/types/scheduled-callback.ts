// A one-shot automated callback queued because an INBOUND call's disposition
// mapped to the `callback` action in the org's outcome policy. The standalone
// analog of a campaign callback (which lives as a state of a campaign_contact).
//
// Lifecycle: pending → in_flight → succeeded | failed (| canceled). The cron
// drainer claims a due `pending` row, dials it (direction='outbound', linked via
// calls.scheduled_callback_id), and the outbound webhook advances it from there.
export type ScheduledCallbackStatus =
  | "pending"
  | "in_flight"
  | "succeeded"
  | "failed"
  | "canceled";

export type ScheduledCallbackOrigin = "inbound_outcome" | "manual";

export interface ScheduledCallback {
  id: string;
  organisation_id: string;
  lead_id: string | null;
  source_call_id: string | null;

  phone: string;
  phone_normalized: string | null;

  agent_id: string;
  from_phone: string | null;

  status: ScheduledCallbackStatus;
  scheduled_at: string;
  next_attempt_at: string;
  attempt: number;
  max_attempts: number;
  retry_interval_seconds: number;

  last_call_id: string | null;
  last_status: string | null;
  last_outcome: string | null;
  last_error: string | null;

  origin: ScheduledCallbackOrigin;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Technical statuses that re-arm a callback for another attempt (when under the
// cap). `completed` is handled separately — reaching the customer ends it.
export const CALLBACK_RETRY_ON: ReadonlySet<string> = new Set([
  "no_answer",
  "busy",
  "failed",
]);
