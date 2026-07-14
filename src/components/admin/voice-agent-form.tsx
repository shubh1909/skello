"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, Trash2Icon, ZapIcon } from "lucide-react";
import { toast } from "sonner";

import {
  disconnectVoiceAgentAdmin,
  testVoiceAgentAdmin,
  updateVoiceAgentAdmin,
  upsertVoiceAgentAdmin,
} from "@/actions/admin/voice-agent";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BolnaIntegration } from "@/types/bolna-integration";

interface Props {
  organisationId: string;
  integration: BolnaIntegration | null;
}

export function VoiceAgentForm({ organisationId, integration }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [agentId, setAgentId] = React.useState(integration?.agent_id ?? "");
  const [apiKey, setApiKey] = React.useState("");
  const [fromPhone, setFromPhone] = React.useState(
    integration?.from_phone_number ?? "",
  );
  const [enabled, setEnabled] = React.useState(integration?.enabled ?? true);
  const [callbacksEnabled, setCallbacksEnabled] = React.useState(
    integration?.callbacks_enabled ?? false,
  );
  const [callbackAgentId, setCallbackAgentId] = React.useState(
    integration?.callback_agent_id ?? "",
  );
  const [callbackFromPhone, setCallbackFromPhone] = React.useState(
    integration?.callback_from_phone ?? "",
  );
  // Blank string = unlimited (null on the row); otherwise an integer 1–1000.
  const [maxConnectedCalls, setMaxConnectedCalls] = React.useState(
    integration?.max_connected_calls_per_lead != null
      ? String(integration.max_connected_calls_per_lead)
      : "",
  );

  const hasExisting = integration !== null;

  function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      if (!hasExisting) {
        if (!agentId.trim() || !apiKey.trim()) {
          toast.error("Agent ID and API key are required");
          return;
        }
        const result = await upsertVoiceAgentAdmin({
          organisation_id: organisationId,
          agent_id: agentId.trim(),
          api_key: apiKey.trim(),
          from_phone_number: fromPhone.trim() || null,
          enabled,
        });
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        toast.success("Voice agent connected");
        setApiKey("");
        router.refresh();
        return;
      }

      const patch: Record<string, unknown> = {
        organisation_id: organisationId,
      };
      if (agentId.trim() !== integration.agent_id) {
        patch.agent_id = agentId.trim();
      }
      if ((fromPhone.trim() || null) !== integration.from_phone_number) {
        patch.from_phone_number = fromPhone.trim() || null;
      }
      if (enabled !== integration.enabled) patch.enabled = enabled;
      if (apiKey.trim().length > 0) patch.api_key = apiKey.trim();
      if (callbacksEnabled !== integration.callbacks_enabled) {
        patch.callbacks_enabled = callbacksEnabled;
      }
      if ((callbackAgentId.trim() || null) !== integration.callback_agent_id) {
        patch.callback_agent_id = callbackAgentId.trim() || null;
      }
      if (
        (callbackFromPhone.trim() || null) !== integration.callback_from_phone
      ) {
        patch.callback_from_phone = callbackFromPhone.trim() || null;
      }

      // Per-lead connected-call cap: blank → unlimited (null); else int 1–1000.
      const rawCap = maxConnectedCalls.trim();
      let capValue: number | null = null;
      if (rawCap !== "") {
        const n = Number(rawCap);
        if (!Number.isInteger(n) || n < 1 || n > 1000) {
          toast.error("Per-lead call cap must be a whole number from 1 to 1000");
          return;
        }
        capValue = n;
      }
      if (capValue !== integration.max_connected_calls_per_lead) {
        patch.max_connected_calls_per_lead = capValue;
      }

      if (Object.keys(patch).length === 1) {
        toast.info("No changes to save");
        return;
      }

      const result = await updateVoiceAgentAdmin(patch);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Voice agent updated");
      setApiKey("");
      router.refresh();
    });
  }

  function onTest() {
    if (!hasExisting) return;
    startTransition(async () => {
      const result = await testVoiceAgentAdmin(organisationId);
      if (!result.success) {
        toast.error("Connection test failed", {
          description: result.error,
          duration: 12000,
        });
        return;
      }
      toast.success("Voice agent connection works", {
        description: `Tested key ••••${result.data.api_key_last4} against agent ${result.data.agent_id}.`,
      });
    });
  }

  function onDisconnect() {
    if (!hasExisting) return;
    if (
      !confirm(
        "Disconnect the voice agent for this workspace? Outbound calls will be disabled immediately.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await disconnectVoiceAgentAdmin(organisationId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Voice agent disconnected");
      setAgentId("");
      setApiKey("");
      setFromPhone("");
      setEnabled(true);
      setCallbacksEnabled(false);
      setCallbackAgentId("");
      setCallbackFromPhone("");
      setMaxConnectedCalls("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSave} className="grid gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Status</span>
          {hasExisting ? (
            integration.enabled ? (
              <Badge>Connected</Badge>
            ) : (
              <Badge variant="secondary">Paused</Badge>
            )
          ) : (
            <Badge variant="outline">Not configured</Badge>
          )}
        </div>
        {hasExisting ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="size-4 accent-foreground"
            />
            Enable outbound calls
          </label>
        ) : null}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="admin-agent-id">Outbound Agent ID</Label>
        <Input
          id="admin-agent-id"
          placeholder="e.g. 9c5f…"
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          autoComplete="off"
          required
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="admin-api-key">
          API Key {hasExisting ? "(leave blank to keep current)" : ""}
        </Label>
        <Input
          id="admin-api-key"
          type="password"
          placeholder={
            hasExisting ? `sk-••••${integration.api_key_last4}` : "sk-…"
          }
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
        />
        <p className="text-[11px] text-muted-foreground">
          Stored server-side only; never returned to the browser.
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="admin-from-phone">Caller ID (optional)</Label>
        <Input
          id="admin-from-phone"
          placeholder="+91-XXXXXXXXXX"
          value={fromPhone}
          onChange={(e) => setFromPhone(e.target.value)}
          autoComplete="off"
        />
      </div>

      {hasExisting ? (
        <div className="grid gap-1.5">
          <Label htmlFor="admin-max-connected">Per-lead call cap</Label>
          <Input
            id="admin-max-connected"
            type="number"
            min={1}
            max={1000}
            placeholder="2"
            value={maxConnectedCalls}
            onChange={(e) => setMaxConnectedCalls(e.target.value)}
            autoComplete="off"
          />
          <p className="text-[11px] text-muted-foreground">
            Max successful calls to one lead across all outbound channels before
            we stop dialling them. Resets every 48 hours. Leave blank for
            unlimited. Default 2.
          </p>
        </div>
      ) : null}

      {hasExisting ? (
        <div className="grid gap-3 rounded-md border p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Automated callbacks</p>
              <p className="text-[11px] text-muted-foreground">
                When an inbound call&rsquo;s outcome resolves to{" "}
                <span className="font-medium">callback</span>, automatically
                call the customer back at the requested time.
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={callbacksEnabled}
                onChange={(e) => setCallbacksEnabled(e.target.checked)}
                className="size-4 accent-foreground"
              />
              Enable
            </label>
          </div>

          {callbacksEnabled ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="callback-agent">
                  Callback agent ID (optional)
                </Label>
                <Input
                  id="callback-agent"
                  placeholder={`Default — ${integration.agent_id}`}
                  value={callbackAgentId}
                  onChange={(e) => setCallbackAgentId(e.target.value)}
                  autoComplete="off"
                />
                <p className="text-[11px] text-muted-foreground">
                  Which agent places the callback. Leave blank to use the
                  outbound agent above.
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="callback-from-phone">
                  Callback caller ID (optional)
                </Label>
                <Input
                  id="callback-from-phone"
                  placeholder={
                    integration.from_phone_number ?? "+91-XXXXXXXXXX"
                  }
                  value={callbackFromPhone}
                  onChange={(e) => setCallbackFromPhone(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2Icon className="animate-spin" /> : null}
            {hasExisting ? "Save changes" : "Connect voice agent"}
          </Button>
          {hasExisting ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onTest}
              title="Probe the voice provider with the saved key + agent ID"
            >
              <ZapIcon />
              Test connection
            </Button>
          ) : null}
        </div>
        {hasExisting ? (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={pending}
            onClick={onDisconnect}
          >
            <Trash2Icon />
            Disconnect
          </Button>
        ) : null}
      </div>
    </form>
  );
}
