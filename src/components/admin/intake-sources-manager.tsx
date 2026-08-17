"use client";

import { useState, useTransition } from "react";
import {
  CheckIcon,
  KeyRoundIcon,
  LinkIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { CopyField } from "@/components/app/copy-field";
import {
  CHANNEL_BRAND,
  ChannelTile,
} from "@/components/app/integrations/channel-brand";
import {
  IntegrationSection as Section,
  SetupProgress,
} from "@/components/app/integrations/setup-progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  createIntakeSource,
  deleteIntakeSource,
  rotateIntakeToken,
  updateIntakeSource,
} from "@/actions/lead-intake";
import { cn } from "@/lib/utils";
import {
  CREDENTIAL_HINT,
  CREDENTIAL_LABEL,
  OPTIONAL_CREDENTIALS,
  WRITABLE_CREDENTIALS,
  type LeadIntakeChannel,
  type LeadIntakeSource,
} from "@/types/lead-intake";

const CHANNEL_BLURB: Record<LeadIntakeChannel, string> = {
  google_ads:
    "Skelo issues the URL and the key. The customer pastes both into each lead form in Google Ads — nothing is needed from them here.",
  whatsapp:
    "Straight to the Meta Cloud API, not a messaging provider — the ad attribution does not survive a relay. Needs the client's own Meta credentials, which is why this lives here.",
  portal_99acres:
    "99acres posts each enquiry to the URL below. There is no self-serve console — the client's account manager registers it. Field names differ per seller account, so the first delivery is what teaches us the mapping.",
};

const ROUTE_SEGMENT: Record<LeadIntakeChannel, string> = {
  google_ads: "google-ads",
  whatsapp: "whatsapp",
  portal_99acres: "portal",
};

const SELF_ISSUED_LABEL: Partial<Record<LeadIntakeChannel, string>> = {
  google_ads: "Key — paste into Google Ads",
  whatsapp: "Verify token — paste into Meta",
};

interface Props {
  organisationId: string;
  origin: string;
  /** The one channel this tab is about. */
  channel: LeadIntakeChannel;
  source: LeadIntakeSource | null;
}

/**
 * One channel's endpoint, provisioned or not.
 *
 * Scoped to a single channel rather than rendering the whole list, because the
 * admin page is now a tab per integration — the same shape as the customer's
 * page, and the same reason the lead-fields editor takes a `slot`.
 */
export function IntakeSourcesManager({
  organisationId,
  origin,
  channel,
  source,
}: Props) {
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ success: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await fn();
      if (!result.success) toast.error(result.error ?? "Something went wrong");
    });
  }

  if (!source) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          run(() => createIntakeSource({ organisation_id: organisationId, channel }))
        }
        className="group flex w-full items-center gap-3 rounded-xl border border-dashed border-border/80 bg-card/40 px-4 py-4 text-left transition-colors hover:border-primary/50 hover:bg-card disabled:opacity-60"
      >
        <ChannelTile
          channel={channel}
          className="opacity-80 transition-opacity group-hover:opacity-100"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            Connect {CHANNEL_BRAND[channel].label}
          </span>
          <span className="block text-xs text-muted-foreground">
            Issues a webhook address for this workspace. Nothing is live until the
            client pastes it into their console.
          </span>
        </span>
        <PlusIcon className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
      </button>
    );
  }

  return (
    <SourceCard
      // Remounts when the row changes so the credential inputs reset to empty
      // after a save — a filled secret field left on screen reads as "this is
      // the stored value", which it never is.
      key={`${source.id}-${source.updated_at}`}
      source={source}
      organisationId={organisationId}
      origin={origin}
      pending={pending}
      run={run}
    />
  );
}

function SourceCard({
  source,
  organisationId,
  origin,
  pending,
  run,
}: {
  source: LeadIntakeSource;
  organisationId: string;
  origin: string;
  pending: boolean;
  run: (fn: () => Promise<{ success: boolean; error?: string }>) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const brand = CHANNEL_BRAND[source.channel];
  const writable = WRITABLE_CREDENTIALS[source.channel];
  const optional = new Set(OPTIONAL_CREDENTIALS[source.channel]);
  const url = `${origin}/api/webhooks/${ROUTE_SEGMENT[source.channel]}/${source.public_token}`;
  // Only the REQUIRED ones gate readiness. Every portal credential is optional
  // — a portal signs nothing — so a portal endpoint is ready the moment it
  // exists, and must not sit on "Awaiting credentials" forever.
  const credentialsReady = writable
    .filter((key) => !optional.has(key))
    .every((key) => source.configured_credentials.includes(key));
  const hasRequired = writable.some((key) => !optional.has(key));

  // Only non-empty fields are sent. An untouched input must not blank a stored
  // secret, and a saved-then-cleared field would do exactly that.
  const filled = Object.entries(draft).filter(([, v]) => v.trim().length > 0);

  return (
    <Card className="overflow-hidden p-0">
      <header className="flex flex-wrap items-center gap-3 border-b border-border/60 bg-muted/30 px-5 py-4">
        <ChannelTile channel={source.channel} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-base font-semibold">
              {brand.label}
            </h2>
            {!source.enabled ? (
              <Badge variant="secondary">
                <PauseCircleIcon /> Paused
              </Badge>
            ) : !credentialsReady ? (
              <Badge variant="warning">Awaiting credentials</Badge>
            ) : source.last_event_at ? (
              <Badge variant="success">Receiving leads</Badge>
            ) : (
              <Badge variant="outline">No leads yet</Badge>
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
            ...(hasRequired
              ? [{ label: "Credentials stored", done: credentialsReady }]
              : []),
            { label: "First lead received", done: Boolean(source.last_event_at) },
          ]}
        />

        <p className="text-sm leading-relaxed text-muted-foreground">
          {CHANNEL_BLURB[source.channel]}
        </p>

        <Separator />

        <Section
          icon={<LinkIcon />}
          title="Endpoint"
          hint="Give both of these to the client. The URL is a secret in its own right — anything reaching it is trusted as coming from them."
        >
          <div className="grid gap-4">
            <CopyField label="Webhook URL" value={url} />
            {source.shared_key ? (
              <CopyField
                label={SELF_ISSUED_LABEL[source.channel] ?? "Shared key"}
                value={source.shared_key}
                secret
              />
            ) : null}
          </div>
        </Section>

        {writable.length > 0 ? (
          <>
            <Separator />
            <Section
              icon={<KeyRoundIcon />}
              title="Client credentials"
              hint="Write-only. Stored values are never shown again — leave a field blank to keep what is already there."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                {writable.map((key) => {
                  const set = source.configured_credentials.includes(key);
                  const isOptional = optional.has(key);
                  return (
                    <div key={key} className="grid gap-1.5">
                      <Label
                        htmlFor={`${source.id}-${key}`}
                        className="flex flex-wrap items-center gap-2"
                      >
                        {CREDENTIAL_LABEL[key] ?? key}
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                            set
                              ? "bg-success-muted text-success"
                              : isOptional
                                ? "bg-muted text-muted-foreground"
                                : "bg-warning-muted text-warning",
                          )}
                        >
                          {set ? <CheckIcon className="size-2.5" /> : null}
                          {set ? "set" : isOptional ? "optional" : "missing"}
                        </span>
                      </Label>
                      <Input
                        id={`${source.id}-${key}`}
                        // An IP allowlist is not a secret and is much easier to
                        // get wrong than to keep private — masking it would only
                        // stop an admin proof-reading what they typed.
                        type={key === "allowed_ips" ? "text" : "password"}
                        autoComplete="off"
                        placeholder={set ? "Replace…" : "Paste value"}
                        value={draft[key] ?? ""}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [key]: e.target.value }))
                        }
                      />
                      {CREDENTIAL_HINT[key] ? (
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          {CREDENTIAL_HINT[key]}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div>
                <Button
                  disabled={pending || filled.length === 0}
                  onClick={() =>
                    run(() =>
                      updateIntakeSource({
                        organisation_id: organisationId,
                        id: source.id,
                        credentials: Object.fromEntries(filled),
                      }),
                    )
                  }
                >
                  {pending
                    ? "Saving…"
                    : filled.length > 0
                      ? `Save ${filled.length} credential${filled.length > 1 ? "s" : ""}`
                      : "Save credentials"}
                </Button>
              </div>
            </Section>
          </>
        ) : null}

        <Separator />

        <Section icon={<SlidersHorizontalIcon />} title="Controls">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(() =>
                  updateIntakeSource({
                    organisation_id: organisationId,
                    id: source.id,
                    enabled: !source.enabled,
                  }),
                )
              }
            >
              {source.enabled ? <PauseCircleIcon /> : <PlayCircleIcon />}
              {source.enabled ? "Pause" : "Resume"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(() =>
                  rotateIntakeToken({
                    organisation_id: organisationId,
                    id: source.id,
                  }),
                )
              }
            >
              <RefreshCwIcon /> New URL and key
            </Button>

            <span className="ml-auto">
              {confirmingDelete ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Remove it? Leads already captured stay.
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(() =>
                        deleteIntakeSource({
                          organisation_id: organisationId,
                          id: source.id,
                        }),
                      )
                    }
                  >
                    Remove
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Cancel
                  </Button>
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2Icon /> Remove
                </Button>
              )}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Issuing a new URL breaks the old one immediately — the client has to
            paste the new pair into every form or webhook setting that used it.
          </p>
        </Section>
      </CardContent>
    </Card>
  );
}
