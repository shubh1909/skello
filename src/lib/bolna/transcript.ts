import type { CallTurnSpeaker } from "@/types/call-transcript";

/**
 * Parsed utterance ready for insert into `call_transcripts`.
 * `started_ms` / `confidence` are left null — the provider's transcript blob
 * doesn't include them; they're there so the shape matches the DB row when
 * a future provider does supply timing.
 */
export interface ParsedTurn {
  seq: number;
  speaker: CallTurnSpeaker;
  text: string;
  started_ms: number | null;
  ended_ms: number | null;
  confidence: number | null;
}

const SPEAKER_ALIASES: Record<string, CallTurnSpeaker> = {
  assistant: "agent",
  agent: "agent",
  bot: "agent",
  ai: "agent",
  user: "user",
  customer: "user",
  caller: "user",
  human: "user",
  system: "system",
};

// Match a speaker label at the start of a line — optional timestamp prefix
// like "[00:12]" is stripped before matching.
const SPEAKER_LINE =
  /^\s*(?:\[\s*\d{1,2}:\d{2}(?::\d{2})?\s*\]\s*)?(Assistant|Agent|Bot|AI|User|Customer|Caller|Human|System)\s*:\s*(.*)$/i;

/**
 * Parse a raw transcript blob into discrete turns.
 *
 * The voice provider gives us a single formatted string like:
 *
 *   Assistant: Hello, how can I help?
 *   User: I want to buy a Yamaha.
 *   Assistant: Sure, which model?
 *   ...
 *
 * Lines that aren't labelled are appended to the previous turn (mid-utterance
 * wraps). If nothing matches at all, we return a single `system` turn with the
 * whole blob — that way the UI can still show *something* and FTS still works.
 */
export function parseTranscript(raw: string | null | undefined): ParsedTurn[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (trimmed === "") return [];

  const lines = trimmed.split(/\r?\n/);
  const turns: ParsedTurn[] = [];
  let current: { speaker: CallTurnSpeaker; parts: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const text = current.parts.join("\n").trim();
    if (text === "") {
      current = null;
      return;
    }
    turns.push({
      seq: turns.length,
      speaker: current.speaker,
      text,
      started_ms: null,
      ended_ms: null,
      confidence: null,
    });
    current = null;
  };

  for (const line of lines) {
    const match = SPEAKER_LINE.exec(line);
    if (match) {
      flush();
      const alias = (match[1] ?? "").toLowerCase();
      const speaker = SPEAKER_ALIASES[alias] ?? "system";
      current = { speaker, parts: [match[2] ?? ""] };
    } else if (current) {
      current.parts.push(line);
    } else {
      // Leading unlabelled prose — bucket as system.
      current = { speaker: "system", parts: [line] };
    }
  }
  flush();

  if (turns.length === 0) {
    // Nothing parsed at all — keep the blob searchable as a single turn.
    return [
      {
        seq: 0,
        speaker: "system",
        text: trimmed,
        started_ms: null,
        ended_ms: null,
        confidence: null,
      },
    ];
  }
  return turns;
}
