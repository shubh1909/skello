export interface BolnaIntegration {
  organisation_id: string;
  agent_id: string;
  from_phone_number: string | null;
  enabled: boolean;
  // Spam-avoidance: max outbound dials per caller-ID per rolling 24h before
  // the campaign dispatcher rests that number. Admin-tunable per org.
  daily_calls_per_number: number;
  created_at: string;
  updated_at: string;
  // Display-only — the full api_key never leaves the server.
  api_key_last4: string;
}
