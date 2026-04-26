import Link from "next/link";
import { ClockIcon, SparklesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { BolnaIntegration } from "@/types/bolna-integration";

interface Props {
  integration: BolnaIntegration | null;
}

const FRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Dashboard/pulse banner. Three states, renders `null` if nothing to say:
 *   - No integration at all → "Awaiting provisioning" (once, mild)
 *   - Integration created in the last 7 days → "Voice agent connected" (celebration)
 *   - Integration older than 7 days and enabled → null (no noise)
 */
export function VoiceAgentBanner({ integration }: Props) {
  if (!integration) {
    return (
      <Card className="flex-row items-center gap-3 border-amber-500/30 bg-amber-500/5 p-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300">
          <ClockIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            Your voice agent is being provisioned
          </p>
          <p className="text-xs text-muted-foreground">
            Our team is setting this up for your workspace. You&apos;ll see it
            here once it&apos;s ready.
          </p>
        </div>
      </Card>
    );
  }

  const ageMs = Date.now() - new Date(integration.created_at).getTime();
  if (ageMs > FRESH_WINDOW_MS) return null;

  return (
    <Card
      className={cn(
        "flex-row items-center gap-3 border-primary/30 bg-primary/5 p-4",
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
        <SparklesIcon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          Voice agent connected
          {integration.enabled ? "" : " — currently paused"}
        </p>
        <p className="text-xs text-muted-foreground">
          Outbound calls and inbound capture are live for your workspace. View
          details on the Settings page.
        </p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        render={<Link href="/settings" />}
      >
        View details
      </Button>
    </Card>
  );
}
