import { PhoneCallIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { RecoveryVoiceAgent } from "@/types/shopify";

// Read-only summary of the voice agent that places recovery calls. Product copy
// never names the underlying provider — it's always "voice agent".
export function RecoveryAgentCard({
  voiceAgent,
}: {
  voiceAgent: RecoveryVoiceAgent | null;
}) {
  const configured = voiceAgent?.configured ?? false;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Voice agent
        </span>
        <Badge
          className={
            configured
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
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
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Agent
              </span>
              <span className="truncate text-sm font-medium">
                {voiceAgent?.name ?? "Default agent"}
              </span>
            </div>
          </div>
          <div className="flex flex-col justify-center">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              Calls placed from
            </span>
            <span className="font-mono text-sm tabular-nums">
              {voiceAgent?.callerNumber ?? "—"}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No voice agent is connected for this workspace yet. Ask your Skelo
          contact to set one up so recovery calls can be placed.
        </p>
      )}
    </Card>
  );
}
