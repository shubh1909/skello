import Link from "next/link";
import { ClockIcon, SparklesIcon } from "lucide-react";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
      <Alert variant="warning">
        <ClockIcon />
        <AlertTitle>Your voice agent is being provisioned</AlertTitle>
        <AlertDescription>
          Our team is setting this up for your workspace. You&apos;ll see it here
          once it&apos;s ready.
        </AlertDescription>
      </Alert>
    );
  }

  const ageMs = Date.now() - new Date(integration.created_at).getTime();
  if (ageMs > FRESH_WINDOW_MS) return null;

  return (
    // The celebration state keeps `primary` rather than a status tone: nothing is
    // wrong, so success/warning would both misreport it.
    <Alert className="border-primary/30 bg-primary/5 text-primary">
      <SparklesIcon />
      <AlertTitle>
        Voice agent connected
        {integration.enabled ? "" : " — currently paused"}
      </AlertTitle>
      <AlertDescription>
        Outbound calls and inbound capture are live for your workspace. View
        details on the Settings page.
      </AlertDescription>
      <AlertAction>
        <Button size="sm" variant="ghost" render={<Link href="/settings" />}>
          View details
        </Button>
      </AlertAction>
    </Alert>
  );
}
