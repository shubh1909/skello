"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { assignCallback } from "@/actions/callbacks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fromLocalDateTimeInput, toLocalDateTimeInputValue } from "@/lib/format";

/**
 * Queue an automated callback: the voice agent rings the lead at the chosen
 * time via the existing `scheduled_callbacks` drainer.
 *
 * This is NOT a reminder. A reminder tells a person to call; this tells the
 * agent to. The copy says so, because "assign callback" alone reads like
 * either one and the difference is who does the work.
 */
export function AssignCallbackDialog({
  leadId,
  leadName,
  open,
  onOpenChange,
  onAssigned,
}: {
  leadId: string | null;
  leadName: string | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onAssigned?: () => void;
}) {
  // Defaults to an hour out — the same default the reminder composer uses, and
  // a time that is always valid against the action's "must be in the future".
  //
  // Re-seeding on open happens by REMOUNT: the sheet keys this dialog on the
  // lead and the open flag. An effect that reset `when` when `open` flipped
  // would compute "an hour from now" one render after the dialog was already
  // showing yesterday's default.
  const [when, setWhen] = React.useState(() => toLocalDateTimeInputValue());
  const [pending, startTransition] = React.useTransition();

  function onSubmit() {
    if (!leadId) return;
    startTransition(async () => {
      const result = await assignCallback({
        lead_id: leadId,
        // The input is wall-clock local; the queue compares against UTC now().
        scheduled_at: fromLocalDateTimeInput(when),
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Callback queued — the voice agent will ring them");
      onOpenChange(false);
      onAssigned?.();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign callback</DialogTitle>
          <DialogDescription>
            The voice agent will call{" "}
            {leadName ? <strong>{leadName}</strong> : "this lead"} at the time
            you pick. Nobody on your team needs to do anything.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5">
          <Label htmlFor="callback-when">Call them at</Label>
          <Input
            id="callback-when"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            disabled={pending}
          />
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={pending || !when}>
            {pending ? <Loader2Icon className="animate-spin" /> : null}
            Queue callback
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
