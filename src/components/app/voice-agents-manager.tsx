"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2Icon,
  Loader2Icon,
  PauseCircleIcon,
  PencilIcon,
  PlusIcon,
  ShieldAlertIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  registerVoiceAgent,
  removeVoiceAgent,
  updateVoiceAgent,
} from "@/actions/voice-agents";
import { formatDateTime } from "@/lib/format";
import type { VoiceAgent } from "@/types/voice-agent";

interface Props {
  organisationId: string;
  agents: VoiceAgent[];
  defaultAgentId: string | null;
  integrationReady: boolean;
}

export function VoiceAgentsManager({
  organisationId,
  agents,
  defaultAgentId,
  integrationReady,
}: Props) {
  return (
    <div className="space-y-4">
      {!integrationReady ? (
        <Card className="flex items-start gap-3 border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="space-y-1">
            <p className="font-medium">
              Connect the voice provider first
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              The workspace needs an API key on file before agents can be
              claimed. Connect the voice agent on the organisation overview
              page, then come back here.
            </p>
          </div>
        </Card>
      ) : null}

      <div className="flex items-center justify-end">
        <RegisterDialog
          organisationId={organisationId}
          disabled={!integrationReady}
        />
      </div>

      {agents.length === 0 ? (
        <Card className="items-center gap-2 py-16 text-center">
          <p className="text-sm font-medium">No agents linked yet</p>
          <p className="max-w-md text-xs text-muted-foreground">
            Add an agent above. We'll verify the id against your voice
            provider account before claiming it.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border/60 bg-muted/30">
                <tr className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Label</th>
                  <th className="px-3 py-3 font-medium">Agent id</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Linked</th>
                  <th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {agents.map((agent) => (
                  <Row
                    key={agent.agent_id}
                    organisationId={organisationId}
                    agent={agent}
                    isDefault={agent.agent_id === defaultAgentId}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Row({
  organisationId,
  agent,
  isDefault,
}: {
  organisationId: string;
  agent: VoiceAgent;
  isDefault: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [editing, setEditing] = React.useState(false);
  const [label, setLabel] = React.useState(agent.label ?? "");

  function onSaveLabel() {
    const next = label.trim() || null;
    if (next === (agent.label ?? null)) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      const res = await updateVoiceAgent({
        organisation_id: organisationId,
        agent_id: agent.agent_id,
        label: next,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Label updated");
      setEditing(false);
      router.refresh();
    });
  }

  function onToggleEnabled() {
    startTransition(async () => {
      const res = await updateVoiceAgent({
        organisation_id: organisationId,
        agent_id: agent.agent_id,
        enabled: !agent.enabled,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(
        agent.enabled ? "Agent disabled" : "Agent enabled",
      );
      router.refresh();
    });
  }

  function onRemove() {
    if (isDefault) {
      toast.error(
        "This is the default agent. Change the default on the voice agent card first.",
      );
      return;
    }
    if (
      !confirm(
        `Remove ${agent.label ?? agent.agent_id}? Calls from this agent will stop routing to this workspace.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await removeVoiceAgent({
        organisation_id: organisationId,
        agent_id: agent.agent_id,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Agent removed");
      router.refresh();
    });
  }

  return (
    <tr className="align-middle">
      <td className="px-5 py-3">
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={120}
              placeholder="e.g. Sales follow-up"
              className="h-8 max-w-[220px]"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") onSaveLabel();
                if (e.key === "Escape") {
                  setLabel(agent.label ?? "");
                  setEditing(false);
                }
              }}
            />
            <Button size="xs" onClick={onSaveLabel} disabled={pending}>
              Save
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setLabel(agent.label ?? "");
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {agent.label ?? <span className="italic text-muted-foreground">Unlabelled</span>}
            </span>
            {isDefault ? (
              <Badge variant="outline" className="text-[10px]">
                Default
              </Badge>
            ) : null}
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setEditing(true)}
              aria-label="Edit label"
              title="Edit label"
            >
              <PencilIcon />
            </Button>
          </div>
        )}
      </td>
      <td className="px-3 py-3">
        <span className="font-mono text-xs text-muted-foreground">
          {agent.agent_id.slice(0, 8)}
          {agent.agent_id.length > 8 ? "…" : ""}
        </span>
      </td>
      <td className="px-3 py-3">
        {agent.enabled ? (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2Icon className="size-3" /> Active
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1">
            <PauseCircleIcon className="size-3" /> Disabled
          </Badge>
        )}
      </td>
      <td className="px-3 py-3 text-xs text-muted-foreground">
        <span suppressHydrationWarning>
          {agent.verified_at ? formatDateTime(agent.verified_at) : "—"}
        </span>
      </td>
      <td className="px-5 py-3">
        <div className="flex items-center justify-end gap-1.5">
          <Button
            size="xs"
            variant="ghost"
            onClick={onToggleEnabled}
            disabled={pending}
          >
            {agent.enabled ? "Disable" : "Enable"}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onRemove}
            disabled={pending || isDefault}
            aria-label="Remove agent"
            title={
              isDefault
                ? "Default agent — change default first"
                : "Remove agent"
            }
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2Icon />
          </Button>
        </div>
      </td>
    </tr>
  );
}

function RegisterDialog({
  organisationId,
  disabled,
}: {
  organisationId: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [agentId, setAgentId] = React.useState("");
  const [label, setLabel] = React.useState("");

  function reset() {
    setAgentId("");
    setLabel("");
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!agentId.trim()) {
      toast.error("Agent id is required");
      return;
    }
    startTransition(async () => {
      const res = await registerVoiceAgent({
        organisation_id: organisationId,
        agent_id: agentId.trim(),
        label: label.trim() || null,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Agent linked");
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button disabled={disabled}>
            <PlusIcon /> Add agent
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link a voice agent</DialogTitle>
          <DialogDescription>
            Paste the agent id from your voice provider dashboard. We'll
            verify it before linking.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="va-id">Agent id</Label>
            <Input
              id="va-id"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              maxLength={200}
              placeholder="9c5f12ab-…"
              autoComplete="off"
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="va-label">Label (optional)</Label>
            <Input
              id="va-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={120}
              placeholder="e.g. Sales follow-up"
              autoComplete="off"
            />
            <p className="text-[11px] text-muted-foreground">
              Shown in the agents list. Make it descriptive — "Renewal
              nurture" reads better than the raw id.
            </p>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : null}
              {pending ? "Verifying…" : "Verify & link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
