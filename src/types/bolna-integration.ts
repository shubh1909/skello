export interface BolnaIntegration {
  organisation_id: string;
  agent_id: string;
  from_phone_number: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  // Display-only — the full api_key never leaves the server.
  api_key_last4: string;
}
