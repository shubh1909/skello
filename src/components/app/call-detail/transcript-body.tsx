import { cn } from "@/lib/utils";
import type {
  CallTranscriptTurn,
  CallTurnSpeaker,
} from "@/types/call-transcript";

const SPEAKER_LABEL: Record<CallTurnSpeaker, string> = {
  agent: "Agent",
  user: "Caller",
  system: "System",
};

/**
 * A call transcript as a conversation, not a wall of text.
 *
 * Agent left, caller right, system centred and italic — the chat idiom, because
 * who said what is the first question anyone asks of a transcript and a
 * `<pre>` blob makes you parse speaker prefixes by eye.
 */
export function TranscriptBody({ turns }: { turns: CallTranscriptTurn[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {turns.map((turn) => {
        const isAgent = turn.speaker === "agent";
        const isUser = turn.speaker === "user";
        return (
          <li
            key={turn.id}
            className={cn(
              "flex flex-col gap-0.5",
              isUser ? "items-end" : "items-start",
            )}
          >
            <span className="px-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              {SPEAKER_LABEL[turn.speaker]}
            </span>
            <div
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                isAgent
                  ? "rounded-tl-sm bg-muted text-foreground"
                  : isUser
                    ? "rounded-tr-sm bg-primary text-primary-foreground"
                    : "rounded-md bg-muted/60 italic text-muted-foreground",
              )}
            >
              {turn.text}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
