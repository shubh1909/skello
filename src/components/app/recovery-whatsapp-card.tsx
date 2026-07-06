import { MessageCircleIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { RecoveryWhatsAppStatus } from "@/types/shopify";

// Read-only summary of the WhatsApp channel for the recovery page. Never names
// the underlying provider — product copy says "WhatsApp".
export function RecoveryWhatsAppCard({
  whatsApp,
}: {
  whatsApp: RecoveryWhatsAppStatus | null;
}) {
  const configured = whatsApp?.configured ?? false;
  const enabled = whatsApp?.enabled ?? false;
  const live = configured && enabled;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          WhatsApp
        </span>
        <Badge
          className={
            live
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
              : "bg-muted text-muted-foreground"
          }
        >
          {!configured ? "Not connected" : enabled ? "Active" : "Off"}
        </Badge>
      </div>

      {configured ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <MessageCircleIcon className="size-4" />
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Sender
              </span>
              <span className="truncate text-sm font-medium">
                {whatsApp?.sender ?? "Default"}
              </span>
            </div>
          </div>
          <div className="flex flex-col justify-center">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              Template
            </span>
            <span className="truncate font-mono text-sm">
              {whatsApp?.templateName ?? "—"}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {enabled
            ? "WhatsApp is enabled but no approved template is set yet — sends are skipped until one is added."
            : "WhatsApp isn't connected for this workspace. Add it in Settings to message abandoned carts."}
        </p>
      )}
    </Card>
  );
}
