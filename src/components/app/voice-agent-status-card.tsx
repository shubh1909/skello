import { CheckCircle2Icon, ClockIcon, PauseCircleIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BolnaIntegration } from "@/types/bolna-integration";

interface Props {
  integration: BolnaIntegration | null;
}

/**
 * Read-only status card for the voice agent. Everything configurable has
 * moved to the admin console — owners can see state and read the last-4 of
 * the key, but can't change anything. They contact support for changes.
 */
export function VoiceAgentStatusCard({ integration }: Props) {
  const status = !integration
    ? ("not_configured" as const)
    : integration.enabled
      ? ("connected" as const)
      : ("paused" as const);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Voice agent</CardTitle>
          <StatusBadge status={status} />
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {status === "not_configured"
            ? "Your voice agent is being provisioned. You'll see it here once our team connects it."
            : status === "paused"
              ? "Your voice agent is currently paused. Contact support to re-enable outbound calls."
              : "Your voice agent is connected and ready to place outbound calls and capture inbound leads."}
        </p>
      </CardHeader>

      {integration ? (
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-xs text-muted-foreground">Agent ID</dt>
            <dd className="font-mono text-xs">
              {maskAgentId(integration.agent_id)}
            </dd>
            <dt className="text-xs text-muted-foreground">API key</dt>
            <dd className="font-mono text-xs">
              sk-••••{integration.api_key_last4}
            </dd>
            <dt className="text-xs text-muted-foreground">Caller ID</dt>
            <dd className="font-mono text-xs">
              {integration.from_phone_number ?? (
                <span className="font-sans text-muted-foreground">
                  Provider default
                </span>
              )}
            </dd>
          </dl>
          <p className="mt-4 text-[11px] text-muted-foreground">
            Need to change anything? Contact your Skelo support rep.
          </p>
        </CardContent>
      ) : null}
    </Card>
  );
}

function StatusBadge({
  status,
}: {
  status: "not_configured" | "connected" | "paused";
}) {
  if (status === "connected") {
    return (
      <Badge>
        <CheckCircle2Icon /> Connected
      </Badge>
    );
  }
  if (status === "paused") {
    return (
      <Badge variant="secondary">
        <PauseCircleIcon /> Paused
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <ClockIcon /> Awaiting provisioning
    </Badge>
  );
}

/**
 * "9c5f12ab-abcd-..." → "9c5f•••" — enough to recognise, not enough to leak.
 * Raw agent ids aren't secret (they're in the provider UI) but the status
 * card is a read-only display, so a masked view reads cleaner.
 */
function maskAgentId(id: string): string {
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}•••`;
}
