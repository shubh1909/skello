"use client";

import * as React from "react";
import {
  HeadphonesIcon,
  Loader2Icon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  SettingsIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
  addDialNumber,
  getVoiceConfig,
  removeDialNumber,
  renameDialNumber,
} from "@/actions/voice-config";
import { cn } from "@/lib/utils";
import type {
  DialNumberEntry,
  VoiceAgentEntry,
  VoiceConfig,
} from "@/types/voice-config";

interface VoiceConfigDialogProps {
  organisationId: string;
  /** Re-runs the parent's data fetch when the dialog mutates the config. */
  onConfigChange?: (config: VoiceConfig) => void;
  // Optional controlled mode — lets a parent (e.g. the header menu) own the
  // open state and render its own trigger. Uncontrolled by default.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}

export function VoiceConfigDialog({
  organisationId,
  onConfigChange,
  open: openProp,
  onOpenChange,
  showTrigger = true,
}: VoiceConfigDialogProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger ? (
        <DialogTrigger
          render={
            <Button variant="outline" size="sm">
              <SettingsIcon /> Manage agents &amp; numbers
            </Button>
          }
        />
      ) : null}
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Voice agents &amp; dialling numbers</DialogTitle>
          <DialogDescription>
            Voice agents are configured by your administrator. You can add or
            remove the caller IDs your campaigns use here.
          </DialogDescription>
        </DialogHeader>

        {open ? (
          <VoiceConfigDialogBody
            organisationId={organisationId}
            onConfigChange={onConfigChange}
          />
        ) : null}

        <DialogFooter>
          <DialogClose
            render={<Button variant="outline" type="button" />}
          >
            Done
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoiceConfigDialogBody({
  organisationId,
  onConfigChange,
}: {
  organisationId: string;
  onConfigChange?: (config: VoiceConfig) => void;
}) {
  const [config, setConfig] = React.useState<VoiceConfig | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    const res = await getVoiceConfig({ organisation_id: organisationId });
    setLoading(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setError(null);
    setConfig(res.data);
    onConfigChange?.(res.data);
  }, [organisationId, onConfigChange]);

  React.useEffect(() => {
    // Defer to a microtask so the initial render of the dialog body settles
    // before the refresh's setState calls land. Avoids the
    // react-hooks/set-state-in-effect lint warning while keeping the same
    // observable behavior (a single fetch on first mount).
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  if (loading && !config) {
    return (
      <div className="grid place-items-center py-12 text-muted-foreground">
        <Loader2Icon className="size-5 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
        {error}
      </p>
    );
  }

  if (!config) return null;

  if (!config.enabled) {
    return (
      <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
        Voice agent is disabled for this workspace. Enable it in Settings
        before adding agents or numbers.
      </p>
    );
  }

  function applyConfig(next: VoiceConfig) {
    setConfig(next);
    onConfigChange?.(next);
  }

  return (
    <div className="grid max-h-[60vh] gap-5 overflow-y-auto pr-1">
      <AgentSection agents={config.agents} />
      <NumberSection
        organisationId={organisationId}
        numbers={config.dial_numbers}
        onApply={applyConfig}
      />
    </div>
  );
}

function AgentSection({ agents }: { agents: VoiceAgentEntry[] }) {
  return (
    <section className="grid gap-2.5">
      <header className="flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-md bg-muted text-muted-foreground">
          <HeadphonesIcon className="size-3.5" />
        </span>
        <h3 className="text-sm font-semibold">Available voice agents</h3>
      </header>

      <div className="grid gap-1.5">
        {agents.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
            No agents available. Ask your administrator to provision a voice
            agent for this workspace.
          </p>
        ) : null}
        {agents.map((a) => (
          <div
            key={a.id}
            className="flex items-center gap-2 rounded-md border border-border/60 bg-background px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                {a.label}
                {a.is_default ? (
                  <Badge className="bg-amber-100 text-[10px] text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                    <StarIcon className="size-2.5" /> Default
                  </Badge>
                ) : null}
              </p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {a.id}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function NumberSection({
  organisationId,
  numbers,
  onApply,
}: {
  organisationId: string;
  numbers: DialNumberEntry[];
  onApply: (config: VoiceConfig) => void;
}) {
  const [adding, setAdding] = React.useState(false);
  const [phone, setPhone] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [pending, setPending] = React.useState(false);

  async function onAdd() {
    if (!phone.trim()) {
      toast.error("Phone number is required");
      return;
    }
    setPending(true);
    const res = await addDialNumber({
      organisation_id: organisationId,
      phone: phone.trim(),
      label: label.trim(),
    });
    setPending(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success("Number added");
    setPhone("");
    setLabel("");
    setAdding(false);
    onApply(res.data);
  }

  return (
    <section className="grid gap-2.5">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-md bg-muted text-muted-foreground">
            <PhoneIcon className="size-3.5" />
          </span>
          <h3 className="text-sm font-semibold">Dialling numbers</h3>
        </div>
        {!adding ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => setAdding(true)}
          >
            <PlusIcon /> Add number
          </Button>
        ) : null}
      </header>

      <div className="grid gap-1.5">
        {numbers.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
            No dialling numbers yet. Add the caller IDs your campaigns can
            use.
          </p>
        ) : null}
        {numbers.map((n) => (
          <NumberRow
            key={n.phone}
            organisationId={organisationId}
            number={n}
            onApply={onApply}
          />
        ))}
      </div>

      {adding ? (
        <div className="grid gap-2 rounded-md border border-border/60 bg-muted/30 p-3">
          <div className="grid gap-1.5">
            <Label htmlFor="new-from-phone" className="text-xs">
              Caller ID
            </Label>
            <Input
              id="new-from-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 99999 00000"
              maxLength={32}
              disabled={pending}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-from-label" className="text-xs">
              Label <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="new-from-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Mumbai showroom"
              maxLength={80}
              disabled={pending}
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setAdding(false);
                setPhone("");
                setLabel("");
              }}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={onAdd} disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : null}
              Save number
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function NumberRow({
  organisationId,
  number,
  onApply,
}: {
  organisationId: string;
  number: DialNumberEntry;
  onApply: (config: VoiceConfig) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [label, setLabel] = React.useState(number.label);
  const [pending, setPending] = React.useState(false);

  async function onSave() {
    setPending(true);
    const res = await renameDialNumber({
      organisation_id: organisationId,
      phone: number.phone,
      label: label.trim(),
    });
    setPending(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    setEditing(false);
    onApply(res.data);
  }

  async function onRemove() {
    if (!confirm(`Remove dialling number "${number.phone}"?`)) return;
    setPending(true);
    const res = await removeDialNumber({
      organisation_id: organisationId,
      phone: number.phone,
    });
    setPending(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success("Number removed");
    onApply(res.data);
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background px-3 py-2">
      <div className="min-w-0 flex-1">
        {editing ? (
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label"
            maxLength={80}
            disabled={pending}
            className="h-7 text-xs"
          />
        ) : (
          <p className="flex items-center gap-1.5 text-sm font-medium">
            {number.label}
            {number.is_default ? (
              <Badge className="bg-amber-100 text-[10px] text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                <StarIcon className="size-2.5" /> Default
              </Badge>
            ) : null}
          </p>
        )}
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          {number.phone}
        </p>
      </div>
      <div className="flex items-center gap-1">
        {editing ? (
          <Button
            size="xs"
            variant="outline"
            onClick={onSave}
            disabled={pending}
          >
            {pending ? <Loader2Icon className="animate-spin" /> : null}
            Save
          </Button>
        ) : (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => setEditing(true)}
            disabled={pending}
            aria-label="Rename"
          >
            <PencilIcon />
          </Button>
        )}
        {!number.is_default ? (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onRemove}
            disabled={pending}
            aria-label="Remove"
            className={cn("text-muted-foreground hover:text-destructive")}
          >
            <Trash2Icon />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
