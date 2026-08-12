"use client";

import {
  CheckIcon,
  ClockIcon,
  KeyRoundIcon,
  LinkIcon,
  ListChecksIcon,
  PauseCircleIcon,
  XIcon,
} from "lucide-react";

import { CopyField } from "@/components/app/copy-field";
import {
  CHANNEL_BRAND,
  ChannelTile,
} from "@/components/app/integrations/channel-brand";
import {
  IntegrationSection,
  SetupProgress,
} from "@/components/app/integrations/setup-progress";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  CREDENTIAL_LABEL,
  WRITABLE_CREDENTIALS,
  type LeadIntakeChannel,
  type LeadIntakeSource,
} from "@/types/lead-intake";

interface Props {
  source: LeadIntakeSource | null;
  /** Which channel this panel is for — needed even when nothing is provisioned. */
  channel: LeadIntakeChannel;
  /** Origin of this deployment, resolved server-side. */
  origin: string;
  /** Path segment of the webhook route, e.g. "google-ads". */
  routeSegment: string;
  /** What the customer is asked to paste the self-issued secret in as. */
  keyLabel: string;
  keyHint: string;
  /** Shown when Skelo hasn't provisioned this channel for the org yet. */
  unprovisioned: string;
  /** Numbered setup steps the customer performs in the provider's console. */
  steps: string[];
}

/**
 * A provisioned lead source, as the customer sees it.
 *
 * **Read-only by design.** Creating and configuring an endpoint is Skelo-team
 * work in the admin console, the same way voice agents and Shopify already are —
 * so this panel hands over the two values the customer has to paste elsewhere
 * and otherwise reports state.
 *
 * Deliberately the same shape as the admin card — brand tile, progress dots,
 * labelled sections — so a support conversation can point at "the second step"
 * and both sides see the same thing.
 */
export function ChannelPanel({
  source,
  channel,
  origin,
  routeSegment,
  keyLabel,
  keyHint,
  unprovisioned,
  steps,
}: Props) {
  const brand = CHANNEL_BRAND[channel];

  if (!source) {
    return (
      <Card className="overflow-hidden p-0">
        <header className="flex flex-wrap items-center gap-3 border-b border-border/60 bg-muted/30 px-5 py-4">
          <ChannelTile channel={channel} className="opacity-70" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-heading text-base font-semibold">
                {brand.label}
              </h2>
              <Badge variant="outline">
                <ClockIcon /> Not set up
              </Badge>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {brand.tagline}
            </p>
          </div>
        </header>
        <CardContent className="p-5">
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {unprovisioned}
          </p>
        </CardContent>
      </Card>
    );
  }

  const url = `${origin}/api/webhooks/${routeSegment}/${source.public_token}`;
  // Credentials the client has to supply. Google has none — its only secret is
  // the one Skelo issues — so this section disappears there rather than
  // rendering an empty heading.
  const required = WRITABLE_CREDENTIALS[source.channel];
  const missing = required.filter(
    (key) => !source.configured_credentials.includes(key),
  );

  return (
    <Card className="overflow-hidden p-0">
      <header className="flex flex-wrap items-center gap-3 border-b border-border/60 bg-muted/30 px-5 py-4">
        <ChannelTile channel={channel} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-base font-semibold">
              {brand.label}
            </h2>
            {!source.enabled ? (
              <Badge variant="secondary">
                <PauseCircleIcon /> Paused
              </Badge>
            ) : missing.length > 0 ? (
              <Badge variant="warning">Setup incomplete</Badge>
            ) : source.last_event_at ? (
              <Badge variant="success">Receiving leads</Badge>
            ) : (
              <Badge variant="outline">Waiting for the first lead</Badge>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {brand.tagline}
            {source.last_event_at
              ? ` · last delivery ${new Date(source.last_event_at).toLocaleString(
                  undefined,
                  { dateStyle: "medium", timeStyle: "short" },
                )}`
              : null}
          </p>
        </div>
      </header>

      <CardContent className="grid gap-6 p-5">
        <SetupProgress
          steps={[
            { label: "Endpoint issued", done: true },
            ...(required.length > 0
              ? [{ label: "Credentials stored", done: missing.length === 0 }]
              : []),
            {
              label: "First lead received",
              done: Boolean(source.last_event_at),
            },
          ]}
        />

        {!source.enabled ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            This endpoint is paused. Incoming leads are rejected until your Skelo
            contact resumes it.
          </p>
        ) : null}

        <Separator />

        <IntegrationSection
          icon={<LinkIcon />}
          title="Your endpoint"
          hint="Treat the address as a secret — anything reaching it is trusted as coming from you. Ask your Skelo contact for a new one if it leaks."
        >
          <div className="grid gap-4">
            <CopyField label="Webhook URL" value={url} />
            <CopyField
              label={keyLabel}
              value={source.shared_key ?? ""}
              secret
              hint={keyHint}
            />
          </div>
        </IntegrationSection>

        {required.length > 0 ? (
          <>
            <Separator />
            <IntegrationSection
              icon={<KeyRoundIcon />}
              title="What Skelo holds for you"
              hint="Send these to your Skelo contact — never paste them into a message thread you don't control."
            >
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {required.map((key) => {
                  const set = source.configured_credentials.includes(key);
                  return (
                    <li
                      key={key}
                      className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "grid size-4 shrink-0 place-items-center rounded-full",
                          set
                            ? "bg-success-muted text-success"
                            : "bg-warning-muted text-warning",
                        )}
                      >
                        {set ? (
                          <CheckIcon className="size-2.5" />
                        ) : (
                          <XIcon className="size-2.5" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {CREDENTIAL_LABEL[key] ?? key}
                      </span>
                      <span
                        className={cn(
                          "text-[11px]",
                          set ? "text-success" : "text-warning",
                        )}
                      >
                        {set ? "set" : "waiting"}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {missing.length > 0 ? (
                <p className="text-xs leading-relaxed text-warning">
                  Leads cannot arrive until these are in place.
                </p>
              ) : null}
            </IntegrationSection>
          </>
        ) : null}

        <Separator />

        <IntegrationSection icon={<ListChecksIcon />} title="Setting it up">
          <ol className="grid gap-2">
            {steps.map((step, i) => (
              <li key={step} className="flex gap-2.5 text-sm leading-relaxed">
                <span
                  aria-hidden
                  className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground"
                >
                  {i + 1}
                </span>
                <span className="text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>
        </IntegrationSection>
      </CardContent>
    </Card>
  );
}
