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
  const [dailyCap, setDailyCap] = React.useState(
    String(integration?.daily_calls_per_number ?? 200),
  );
  const [enabled, setEnabled] = React.useState(integration?.enabled ?? true);

  const hasExisting = integration !== null;

  function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const capNum = Number(dailyCap);
      if (!Number.isInteger(capNum) || capNum < 1 || capNum > 10000) {
        toast.error("Daily call cap must be a whole number between 1 and 10000");
        return;
      }

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
          daily_calls_per_number: capNum,
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
      if (capNum !== integration.daily_calls_per_number) {
        patch.daily_calls_per_number = capNum;
      }
      if (enabled !== integration.enabled) patch.enabled = enabled;
      if (apiKey.trim().length > 0) patch.api_key = apiKey.trim();

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
      setDailyCap("200");
      setEnabled(true);
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

      <div className="grid gap-1.5">
        <Label htmlFor="admin-daily-cap">Daily calls per number</Label>
        <Input
          id="admin-daily-cap"
          type="number"
          min={1}
          max={10000}
          step={1}
          placeholder="200"
          value={dailyCap}
          onChange={(e) => setDailyCap(e.target.value)}
          autoComplete="off"
        />
        <p className="text-[11px] text-muted-foreground">
          Max outbound dials per caller-ID in 24h before a campaign rests that
          number (spam avoidance). Default 200. Raise it for registered /
          warmed numbers; lower it for fresh ones.
        </p>
      </div>

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
