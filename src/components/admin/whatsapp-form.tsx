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
  disconnectWhatsAppAdmin,
  updateWhatsAppAdmin,
  upsertWhatsAppAdmin,
} from "@/actions/admin/whatsapp";
import type { WhatsAppIntegration } from "@/types/whatsapp-integration";

interface Props {
  organisationId: string;
  integration: WhatsAppIntegration | null;
}

// Admin-only WhatsApp (KwikEngage/Tellephant) provisioning. The workspace owner
// sees a read-only status card in Settings; all config lives here.
export function WhatsAppForm({ organisationId, integration }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [apiToken, setApiToken] = React.useState("");
  const [senderId, setSenderId] = React.useState(integration?.sender_id ?? "");
  const [templateName, setTemplateName] = React.useState(
    integration?.template_name ?? "",
  );
  const [baseUrl, setBaseUrl] = React.useState(integration?.base_url ?? "");
  const [enabled, setEnabled] = React.useState(integration?.enabled ?? true);

  const hasExisting = integration !== null;

  function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      if (!hasExisting) {
        if (!apiToken.trim()) {
          toast.error("API token is required");
          return;
        }
        const result = await upsertWhatsAppAdmin({
          organisation_id: organisationId,
          api_token: apiToken.trim(),
          sender_id: senderId.trim() || null,
          template_name: templateName.trim() || null,
          base_url: baseUrl.trim() || null,
          enabled,
        });
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        toast.success("WhatsApp connected");
        setApiToken("");
        router.refresh();
        return;
      }

      const patch: Record<string, unknown> = { organisation_id: organisationId };
      if ((senderId.trim() || null) !== integration.sender_id) {
        patch.sender_id = senderId.trim() || null;
      }
      if ((templateName.trim() || null) !== integration.template_name) {
        patch.template_name = templateName.trim() || null;
      }
      if ((baseUrl.trim() || null) !== integration.base_url) {
        patch.base_url = baseUrl.trim() || null;
      }
      if (enabled !== integration.enabled) patch.enabled = enabled;
      if (apiToken.trim().length > 0) patch.api_token = apiToken.trim();

      if (Object.keys(patch).length === 1) {
        toast.info("No changes to save");
        return;
      }

      const result = await updateWhatsAppAdmin(patch);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("WhatsApp integration updated");
      setApiToken("");
      router.refresh();
    });
  }

  function onDisconnect() {
    if (!hasExisting) return;
    if (
      !confirm(
        "Disconnect WhatsApp for this workspace? Recovery messages will stop.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await disconnectWhatsAppAdmin(organisationId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("WhatsApp integration removed");
      setApiToken("");
      setSenderId("");
      setTemplateName("");
      setBaseUrl("");
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
            Enable WhatsApp
          </label>
        ) : null}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="wa-token">
          API token {hasExisting ? "(leave blank to keep current)" : ""}
        </Label>
        <Input
          id="wa-token"
          type="password"
          placeholder={
            hasExisting ? `••••${integration.api_token_last4}` : "token…"
          }
          value={apiToken}
          onChange={(e) => setApiToken(e.target.value)}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          From the provider dashboard (Integrations → API). Stored server-side
          only; never shown to the workspace owner.
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="wa-sender">Sender (optional)</Label>
        <Input
          id="wa-sender"
          placeholder="WhatsApp sender / number id"
          value={senderId}
          onChange={(e) => setSenderId(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="wa-template">Approved template name</Label>
        <Input
          id="wa-template"
          placeholder="e.g. abandoned_cart_recovery"
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          The Meta-approved template. Until one is set, WhatsApp sends are
          skipped and voice still runs.
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="wa-base-url">API base URL (optional)</Label>
        <Input
          id="wa-base-url"
          placeholder="Blank uses the default (api.tellephant.com)"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="flex items-center justify-between gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {hasExisting ? "Save changes" : "Connect WhatsApp"}
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
