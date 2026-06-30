"use client";

import * as React from "react";
import {
  HeadphonesIcon,
  Loader2Icon,
  PhoneCallIcon,
  PhoneIcon,
} from "lucide-react";
import { toast } from "sonner";

import { initiateTestCall } from "@/actions/calls";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getVoiceConfig } from "@/actions/voice-config";
import type { VoiceConfig } from "@/types/voice-config";

interface TestCallDialogProps {
  organisationId: string;
  // Optional controlled mode — lets a parent (e.g. the header menu) own the
  // open state and render its own trigger. Uncontrolled by default.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}

// Sentinel select-value meaning "use the org's default dialling number".
// Plain "" would collide with the SelectValue placeholder behavior.
const DEFAULT_FROM_VALUE = "__default__";

// E.164 mirror of the server-side regex in initiateTestCall. We validate
// client-side too so the operator gets an inline error before the network
// round trip — typing speed during a demo matters.
const E164 = /^\+[1-9]\d{6,14}$/;

export function TestCallDialog({
  organisationId,
  open: openProp,
  onOpenChange,
  showTrigger = true,
}: TestCallDialogProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger ? (
        <DialogTrigger
          render={
            <Button variant="outline" size="sm">
              <PhoneCallIcon /> Test call
            </Button>
          }
        />
      ) : null}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Test call</DialogTitle>
          <DialogDescription>
            Place a one-off call from your voice agent — useful for client
            demos. The recording and transcript land in Conversations, but
            the dial doesn&apos;t create a lead and won&apos;t show up in
            your lifetime stats.
          </DialogDescription>
        </DialogHeader>

        {open ? (
          <TestCallDialogBody
            organisationId={organisationId}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function TestCallDialogBody({
  organisationId,
  onClose,
}: {
  organisationId: string;
  onClose: () => void;
}) {
  const [config, setConfig] = React.useState<VoiceConfig | null>(null);
  const [configError, setConfigError] = React.useState<string | null>(null);
  const [loadingConfig, setLoadingConfig] = React.useState(true);

  const [agentId, setAgentId] = React.useState<string>("");
  const [fromValue, setFromValue] = React.useState<string>(DEFAULT_FROM_VALUE);
  const [toPhone, setToPhone] = React.useState<string>("");
  const [dialing, setDialing] = React.useState(false);

  // Fetch the agent / dial-number catalogue on mount. Deferred to a
  // microtask so the initial render of the body settles before any
  // setState lands (mirrors VoiceConfigDialogBody for consistency).
  React.useEffect(() => {
    let cancelled = false;
    queueMicrotask(async () => {
      const res = await getVoiceConfig({ organisation_id: organisationId });
      if (cancelled) return;
      setLoadingConfig(false);
      if (!res.success) {
        setConfigError(res.error);
        return;
      }
      setConfig(res.data);
      const defaultAgent =
        res.data.agents.find((a) => a.is_default)?.id ??
        res.data.agents[0]?.id ??
        "";
      setAgentId(defaultAgent);
    });
    return () => {
      cancelled = true;
    };
  }, [organisationId]);

  const toValid = E164.test(toPhone.trim());
  const toError =
    toPhone.length > 0 && !toValid
      ? "Use E.164, e.g. +14155551234"
      : null;

  // Base UI's <SelectValue/> renders the raw `value` string by default,
  // which here is an agent id or a phone number — both unfriendly. Resolve
  // them back to their human labels and pass as children, mirroring the
  // pattern used by FilterChip in leads-activity-table.
  const selectedAgentLabel =
    config?.agents.find((a) => a.id === agentId)?.label ??
    (agentId ? agentId : "Pick an agent");
  const defaultDialNumber = config?.dial_numbers.find((n) => n.is_default);
  const selectedFromLabel =
    fromValue === DEFAULT_FROM_VALUE
      ? defaultDialNumber
        ? `Default · ${defaultDialNumber.label || defaultDialNumber.phone}`
        : "Default number"
      : (config?.dial_numbers.find((n) => n.phone === fromValue)?.label ??
        fromValue);

  const canDial =
    !!config && config.enabled && agentId.length > 0 && toValid && !dialing;

  async function onDial() {
    if (!canDial) return;
    setDialing(true);
    try {
      const res = await initiateTestCall({
        organisation_id: organisationId,
        agent_id: agentId,
        from_phone:
          fromValue === DEFAULT_FROM_VALUE ? undefined : fromValue,
        to_phone: toPhone.trim(),
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(`Dialling ${toPhone.trim()}…`);
      onClose();
    } finally {
      setDialing(false);
    }
  }

  if (loadingConfig) {
    return (
      <div className="grid place-items-center py-10 text-sm text-muted-foreground">
        <Loader2Icon className="size-5 animate-spin" />
      </div>
    );
  }

  if (configError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        {configError}
      </div>
    );
  }

  if (!config || !config.enabled) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
        Voice agent is disabled for this workspace. Enable it in Settings
        before placing a test call.
      </div>
    );
  }

  if (config.agents.length === 0) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
        No voice agents configured yet. An administrator needs to add one.
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="test-call-agent">
            <HeadphonesIcon className="inline size-3.5 text-muted-foreground" />{" "}
            Agent
          </Label>
          <Select
            value={agentId}
            onValueChange={(v) => v !== null && setAgentId(v)}
            disabled={dialing}
          >
            <SelectTrigger id="test-call-agent" className="w-full">
              <SelectValue placeholder="Pick an agent">
                {selectedAgentLabel}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {config.agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  <div className="flex flex-col">
                    <span>{a.label}</span>
                    {a.is_default ? (
                      <span className="text-xs text-muted-foreground">
                        Default
                      </span>
                    ) : null}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="test-call-from">
            <PhoneIcon className="inline size-3.5 text-muted-foreground" />{" "}
            Dial from
          </Label>
          <Select
            value={fromValue}
            onValueChange={(v) => v !== null && setFromValue(v)}
            disabled={dialing}
          >
            <SelectTrigger id="test-call-from" className="w-full">
              <SelectValue>{selectedFromLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_FROM_VALUE}>
                <div className="flex flex-col">
                  <span>Default number</span>
                  <span className="text-xs text-muted-foreground">
                    {config.dial_numbers.find((n) => n.is_default)?.phone ??
                      "Workspace default"}
                  </span>
                </div>
              </SelectItem>
              {config.dial_numbers.map((n) => (
                <SelectItem key={n.phone} value={n.phone}>
                  <div className="flex flex-col">
                    <span>{n.label || n.phone}</span>
                    {n.label && n.label !== n.phone ? (
                      <span className="font-mono text-xs text-muted-foreground">
                        {n.phone}
                      </span>
                    ) : null}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="test-call-to">
            <PhoneCallIcon className="inline size-3.5 text-muted-foreground" />{" "}
            Call to
          </Label>
          <Input
            id="test-call-to"
            type="tel"
            inputMode="tel"
            placeholder="+14155551234"
            value={toPhone}
            onChange={(e) => setToPhone(e.target.value)}
            disabled={dialing}
            aria-invalid={Boolean(toError)}
            className="font-mono"
          />
          {toError ? (
            <p className="text-xs text-destructive">{toError}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Include the country code with a leading +.
            </p>
          )}
        </div>
      </div>

      <DialogFooter>
        <DialogClose
          render={
            <Button variant="outline" type="button" disabled={dialing} />
          }
        >
          Cancel
        </DialogClose>
        <Button type="button" onClick={onDial} disabled={!canDial}>
          {dialing ? (
            <Loader2Icon className="animate-spin" />
          ) : (
            <PhoneCallIcon />
          )}
          {dialing ? "Dialling…" : "Place test call"}
        </Button>
      </DialogFooter>
    </>
  );
}
