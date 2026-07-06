import { CheckCircle2Icon, ClockIcon, PauseCircleIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WhatsAppIntegration } from "@/types/whatsapp-integration";

interface Props {
  integration: WhatsAppIntegration | null;
}

/**
 * Read-only status card for the WhatsApp channel. All config lives in the admin
 * console — owners see state (sender, template, key last-4) but can't change it.
 */
export function WhatsAppStatusCard({ integration }: Props) {
  const status = !integration
    ? ("not_configured" as const)
    : integration.enabled
      ? ("connected" as const)
      : ("paused" as const);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>WhatsApp</CardTitle>
          <StatusBadge status={status} />
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {status === "not_configured"
            ? "WhatsApp is being provisioned. You'll see it here once our team connects it."
            : status === "paused"
              ? "WhatsApp is currently paused. Contact support to re-enable recovery messages."
              : "WhatsApp is connected and ready to message abandoned-cart shoppers."}
        </p>
      </CardHeader>

      {integration ? (
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-xs text-muted-foreground">Sender</dt>
            <dd className="font-mono text-xs">
              {integration.sender_id ?? (
                <span className="font-sans text-muted-foreground">
                  Provider default
                </span>
              )}
            </dd>
            <dt className="text-xs text-muted-foreground">Template</dt>
            <dd className="font-mono text-xs">
              {integration.template_name ?? (
                <span className="font-sans text-muted-foreground">Not set</span>
              )}
            </dd>
            <dt className="text-xs text-muted-foreground">API token</dt>
            <dd className="font-mono text-xs">
              ••••{integration.api_token_last4}
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
