import { PhoneCallIcon } from "lucide-react";

import { SectionLabel } from "@/components/app/section-label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { CodVoiceAgent } from "@/types/cod";

// Read-only summary of the voice agent that places COD confirmation calls.
// Product copy never names the underlying provider — it's always "voice agent".
export function CodAgentCard({
  voiceAgent,
}: {
  voiceAgent: CodVoiceAgent | null;
}) {
  const configured = voiceAgent?.configured ?? false;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <SectionLabel as="span">
          Voice agent
        </SectionLabel>
        <Badge
          className={
            configured
              ? "bg-success-muted text-success"
              : "bg-muted text-muted-foreground"
          }
        >
          {configured ? "Connected" : "Not connected"}
        </Badge>
      </div>

      {configured ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <PhoneCallIcon className="size-4" />
            </span>
            <div className="flex min-w-0 flex-col">
              <SectionLabel as="span">
                Agent
              </SectionLabel>
              <span className="truncate text-sm font-medium">
                {voiceAgent?.name ?? "Default agent"}
              </span>
            </div>
          </div>
          <div className="flex flex-col justify-center">
            <SectionLabel as="span">
              Calls placed from
            </SectionLabel>
            <span className="font-mono text-sm tabular-nums">
              {voiceAgent?.callerNumber ?? "—"}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No voice agent is connected for this workspace yet. Ask your Skelo
          contact to set one up so confirmation calls can be placed.
        </p>
      )}
    </Card>
  );
}
