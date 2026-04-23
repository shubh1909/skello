"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteBolnaIntegration,
  updateBolnaIntegration,
  upsertBolnaIntegration,
} from "@/actions/bolna-integrations";
import type { BolnaIntegration } from "@/types/bolna-integration";

interface Props {
  organisationId: string;
  integration: BolnaIntegration | null;
}

export function BolnaIntegrationForm({ organisationId, integration }: Props) {
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
      // If no existing record, api_key is required; otherwise allow updating
      // only the fields that changed (api_key stays unless user types a new one).
      if (!hasExisting) {
        if (!agentId.trim() || !apiKey.trim()) {
          toast.error("Agent ID and API key are required");
          return;
        }
        const result = await upsertBolnaIntegration({
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
        toast.success("Bolna integration saved");
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

      const result = await updateBolnaIntegration(patch);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Bolna integration updated");
      setApiKey("");
      router.refresh();
    });
  }

  function onDisconnect() {
    if (!hasExisting) return;
    if (
      !confirm(
        "Disconnect Bolna? Outbound calls will be disabled for this workspace.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteBolnaIntegration(organisationId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Bolna integration removed");
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
              <Badge variant="secondary">Connected</Badge>
            ) : (
              <Badge variant="outline">Disabled</Badge>
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
        <Label htmlFor="bolna-agent-id">Outbound Agent ID</Label>
        <Input
          id="bolna-agent-id"
          placeholder="e.g. 9c5f…"
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          autoComplete="off"
          required
        />
        <p className="text-xs text-muted-foreground">
          Copy from your Bolna dashboard → Agents → the agent you use for
          outbound calls.
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="bolna-api-key">
          API Key {hasExisting ? "(leave blank to keep current)" : ""}
        </Label>
        <Input
          id="bolna-api-key"
          type="password"
          placeholder={
            hasExisting
              ? `sk-••••${integration.api_key_last4}`
              : "sk-…"
          }
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          Stored server-side only; never sent back to the browser.
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="bolna-from-phone">Caller ID (optional)</Label>
        <Input
          id="bolna-from-phone"
          placeholder="+91-XXXXXXXXXX"
          value={fromPhone}
          onChange={(e) => setFromPhone(e.target.value)}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          The number leads will see. If blank, Bolna uses the agent default.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {hasExisting ? "Save changes" : "Connect Bolna"}
        </Button>
        {hasExisting ? (
          <Button
            type="button"
            variant="ghost"
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
