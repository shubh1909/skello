export type CallTurnSpeaker = "agent" | "user" | "system";

export interface CallTranscriptTurn {
  id: string;
  call_id: string;
  organisation_id: string;
  seq: number;
  speaker: CallTurnSpeaker;
  text: string;
  started_ms: number | null;
  ended_ms: number | null;
  confidence: number | null;
  created_at: string;
}
