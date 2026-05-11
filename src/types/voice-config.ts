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
}
