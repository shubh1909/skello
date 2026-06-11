"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CopyIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import {
  createOutcomePolicy,
  deleteOutcomePolicy,
  updateOutcomePolicy,
} from "@/actions/admin/outcome-policies";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OUTCOME_ACTIONS, type OutcomePolicy } from "@/types/outcome-policy";

// Human labels for each action — also the source of truth for the dropdowns.
const ACTION_LABELS: Record<string, string> = {
  succeed: "Succeed — end as success",
  fail: "Fail — end, no retry",
  callback: "Callback — re-dial at requested time",
  retry: "Retry — re-dial at the interval",
};

interface Props {
  organisationId: string;
  policies: OutcomePolicy[];
}

export function OutcomePoliciesEditor({ organisationId, policies }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <AgentLabelsPanel policies={policies} />

      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-muted/30 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 font-medium">Outcome key</th>
              <th className="px-3 py-2 font-medium">Label</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 text-center font-medium">Counts as success</th>
              <th className="px-3 py-2 text-right font-medium">&nbsp;</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {policies.map((p) => (
              <PolicyRow
                key={p.id}
                organisationId={organisationId}
                policy={p}
              />
            ))}
          </tbody>
        </table>
      </div>

      <AddOutcomeForm organisationId={organisationId} />
    </div>
  );
}

function PolicyRow({
  organisationId,
  policy,
}: {
  organisationId: string;
  policy: OutcomePolicy;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [label, setLabel] = React.useState(policy.label);
  const [action, setAction] = React.useState<string>(policy.action);
  const [countsAsSuccess, setCountsAsSuccess] = React.useState(
    policy.counts_as_success,
  );

  const dirty =
    label.trim() !== policy.label ||
    action !== policy.action ||
    countsAsSuccess !== policy.counts_as_success;

  function onSave() {
    if (!label.trim()) {
      toast.error("Label can't be empty");
      return;
    }
    startTransition(async () => {
      const result = await updateOutcomePolicy({
        id: policy.id,
        organisation_id: organisationId,
        label: label.trim(),
        action,
        counts_as_success: countsAsSuccess,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Outcome updated");
      router.refresh();
    });
  }

  function onDelete() {
    if (!confirm(`Delete the "${policy.label}" outcome?`)) return;
    startTransition(async () => {
      const result = await deleteOutcomePolicy({
        id: policy.id,
        organisation_id: organisationId,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Outcome deleted");
      router.refresh();
    });
  }

  return (
    <tr className="align-middle">
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            {policy.outcome_key}
          </code>
          {policy.is_fallback ? (
            <Badge variant="secondary" className="text-[10px]">
              fallback
            </Badge>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-2.5">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={pending}
          className="h-8"
        />
      </td>
      <td className="px-3 py-2.5">
        <Select
          value={action}
          onValueChange={(v) => v !== null && setAction(v)}
          disabled={pending}
        >
          <SelectTrigger className="h-8 w-full min-w-56">
            <SelectValue>{ACTION_LABELS[action] ?? action}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {OUTCOME_ACTIONS.map((a) => (
              <SelectItem key={a} value={a}>
                {ACTION_LABELS[a]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-3 py-2.5 text-center">
        <input
          type="checkbox"
          checked={countsAsSuccess}
          onChange={(e) => setCountsAsSuccess(e.target.checked)}
          disabled={pending}
          className="size-4 accent-foreground"
          aria-label="Counts as success"
        />
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-end gap-1.5">
          <Button size="sm" onClick={onSave} disabled={pending || !dirty}>
            {pending ? <Loader2Icon className="animate-spin" /> : null}
            Save
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onDelete}
            disabled={pending || policy.is_fallback}
            title={
              policy.is_fallback
                ? "The fallback outcome can't be deleted"
                : "Delete outcome"
            }
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2Icon className="size-4" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

function AddOutcomeForm({ organisationId }: { organisationId: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [key, setKey] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [action, setAction] = React.useState<string>("succeed");
  const [countsAsSuccess, setCountsAsSuccess] = React.useState(false);

  function onAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!key.trim() || !label.trim()) {
      toast.error("Key and label are required");
      return;
    }
    startTransition(async () => {
      const result = await createOutcomePolicy({
        organisation_id: organisationId,
        outcome_key: key.trim(),
        label: label.trim(),
        action,
        counts_as_success: countsAsSuccess,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Outcome added");
      setKey("");
      setLabel("");
      setAction("succeed");
      setCountsAsSuccess(false);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={onAdd}
      className="grid gap-3 rounded-lg border border-border/60 bg-muted/20 p-4"
    >
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Add an outcome
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="new-outcome-key">Outcome key (what the agent emits)</Label>
          <Input
            id="new-outcome-key"
            placeholder="e.g. demo_scheduled"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            disabled={pending}
            autoComplete="off"
          />
          <p className="text-[11px] text-muted-foreground">
            Spaces/casing are normalised (e.g. “Demo Scheduled” → demo_scheduled).
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="new-outcome-label">Display label</Label>
          <Input
            id="new-outcome-label"
            placeholder="e.g. Demo scheduled"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={pending}
            autoComplete="off"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <div className="grid gap-1.5">
          <Label>Action</Label>
          <Select
            value={action}
            onValueChange={(v) => v !== null && setAction(v)}
            disabled={pending}
          >
            <SelectTrigger className="w-full min-w-64">
              <SelectValue>{ACTION_LABELS[action] ?? action}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {OUTCOME_ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {ACTION_LABELS[a]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={countsAsSuccess}
            onChange={(e) => setCountsAsSuccess(e.target.checked)}
            disabled={pending}
            className="size-4 accent-foreground"
          />
          Counts as success
        </label>
        <Button type="submit" disabled={pending} className="ml-auto">
          {pending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
          Add outcome
        </Button>
      </div>
    </form>
  );
}

function AgentLabelsPanel({ policies }: { policies: OutcomePolicy[] }) {
  const keys = policies.map((p) => p.outcome_key);
  const joined = keys.join(", ");

  function onCopy() {
    navigator.clipboard
      .writeText(joined)
      .then(() => toast.success("Outcome keys copied"))
      .catch(() => toast.error("Couldn't copy"));
  }

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">Keep your voice agent in sync</p>
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Your voice agent must emit one of these exact{" "}
            <code className="font-mono">call_outcome</code> values for the
            switching + success rules to apply. Any value it emits that isn’t
            listed here falls back to the{" "}
            <code className="font-mono">no_decision</code> outcome.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onCopy} disabled={!keys.length}>
          <CopyIcon className="size-3.5" />
          Copy
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {keys.map((k) => (
          <code
            key={k}
            className="rounded bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground/80 ring-1 ring-border"
          >
            {k}
          </code>
        ))}
      </div>
    </div>
  );
}
