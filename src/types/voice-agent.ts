export interface VoiceAgent {
  agent_id: string;
  organisation_id: string;
  label: string | null;
  enabled: boolean;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}
