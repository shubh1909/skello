"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import {
  disconnectVoiceAgentAdmin,
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

      <div className="flex items-center justify-between gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2Icon className="animate-spin" /> : null}
          {hasExisting ? "Save changes" : "Connect voice agent"}
        </Button>
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
