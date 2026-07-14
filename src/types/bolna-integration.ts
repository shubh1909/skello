export interface BolnaIntegration {
  organisation_id: string;
  agent_id: string;
  from_phone_number: string | null;
  enabled: boolean;
  // Spam-avoidance: max outbound dials per caller-ID per rolling 24h before
  // the campaign dispatcher rests that number. Admin-tunable per org.
  daily_calls_per_number: number;
  // Global per-org governor: max successful connections to one lead (dialled
  // phone) across ALL outbound surfaces (recovery, campaigns, callbacks) in a
  // rolling 48h window before dispatchers stop dialling that lead. Default 2;
  // null = unlimited. See lib/calls/connect-cap.ts.
  max_connected_calls_per_lead: number | null;
  // Automated inbound callbacks (see scheduled_callbacks). `callbacks_enabled`
  // is the per-org opt-in; when on, an inbound call whose disposition maps to
  // the `callback` action queues an outbound callback from `callback_agent_id`
  // (falling back to `agent_id`) and `callback_from_phone` (falling back to
  // `from_phone_number`).
  callbacks_enabled: boolean;
  callback_agent_id: string | null;
  callback_from_phone: string | null;
  created_at: string;
  updated_at: string;
  // Display-only — the full api_key never leaves the server.
  api_key_last4: string;
}
