import { CheckCircle2Icon, ClockIcon, PauseCircleIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ShopifyIntegrationStatus } from "@/types/shopify";

interface Props {
  status: ShopifyIntegrationStatus | null;
}

/**
 * Read-only Shopify connection status for the owner's settings page. Connecting
 * / authorizing a store is done by the Skelo admin team — owners just see the
 * current state and the general details of the linked store.
 */
export function ShopifyStatusCard({ status }: Props) {
  const state = !status
    ? ("not_connected" as const)
    : !status.authorized
      ? ("connected" as const) // credentials saved, OAuth not finished
      : !status.enabled
        ? ("paused" as const)
        : ("authorized" as const);

  // Shopify returns granted scopes as a comma-separated string (e.g.
  // "read_checkouts,read_orders"); tolerate whitespace too.
  const scopeList = (status?.scope ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Shopify store</CardTitle>
          <StatusBadge state={state} />
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {state === "not_connected"
            ? "No Shopify store is linked yet. Your Skelo team connects and authorizes it for you."
            : state === "connected"
              ? "Credentials are saved; the store still needs to be authorized to go live. Contact your Skelo team."
              : state === "paused"
                ? "This store is linked but currently paused. Contact support to re-enable it."
                : "Your Shopify store is connected and authorized — abandoned-cart events flow in automatically."}
        </p>
      </CardHeader>

      {status ? (
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-xs text-muted-foreground">Store</dt>
            <dd className="font-mono text-xs">
              <a
                href={`https://${status.shop_domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-4 hover:underline"
              >
                {status.shop_domain}
              </a>
            </dd>
            <dt className="text-xs text-muted-foreground">API version</dt>
            <dd className="font-mono text-xs">{status.api_version}</dd>
            <dt className="text-xs text-muted-foreground">Access scopes</dt>
            <dd>
              {scopeList.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {scopeList.map((scope) => (
                    <Badge key={scope} variant="secondary" className="font-mono">
                      {scope}
                    </Badge>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Not yet granted
                </span>
              )}
            </dd>
            <dt className="text-xs text-muted-foreground">Last updated</dt>
            <dd className="text-xs">
              {new Date(status.updated_at).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </dd>
          </dl>
          <p className="mt-4 text-[11px] text-muted-foreground">
            Need to connect a different store or change access? Contact your Skelo
            support rep.
          </p>
        </CardContent>
      ) : null}
    </Card>
  );
}

function StatusBadge({
  state,
}: {
  state: "not_connected" | "connected" | "paused" | "authorized";
}) {
  if (state === "authorized") {
    return (
      <Badge>
        <CheckCircle2Icon /> Connected
      </Badge>
    );
  }
  if (state === "paused") {
    return (
      <Badge variant="secondary">
        <PauseCircleIcon /> Paused
      </Badge>
    );
  }
  if (state === "connected") {
    return (
      <Badge variant="secondary">
        <ClockIcon /> Awaiting authorization
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <ClockIcon /> Not connected
    </Badge>
  );
}
