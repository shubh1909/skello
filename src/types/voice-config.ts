export interface VoiceAgentEntry {
  id: string;
  label: string;
  is_default: boolean;
}

export interface DialNumberEntry {
  phone: string;
  label: string;
  is_default: boolean;
}

export interface VoiceConfig {
  enabled: boolean;
  agents: VoiceAgentEntry[];
  dial_numbers: DialNumberEntry[];
  // Per-org spam-avoidance cap: max dials per caller-ID per day. Drives the
  // campaign-create capacity warning. Admin-tunable on the voice-agent page.
  daily_calls_per_number: number;
}
