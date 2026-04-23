"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarPlusIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { createReminder } from "@/actions/reminders";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fromLocalDateTimeInput,
  toLocalDateTimeInputValue,
} from "@/lib/format";
import type { ReminderType } from "@/types/reminder";

const TYPES: { value: ReminderType; label: string }[] = [
  { value: "call", label: "Call" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "visit", label: "Visit" },
  { value: "other", label: "Other" },
];

interface ReminderDialogProps {
  organisationId: string;
  leadId?: string | null;
  leadName?: string | null;
  trigger?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ReminderDialog({
  organisationId,
  leadId,
  leadName,
  trigger,
  open,
  onOpenChange,
}: ReminderDialogProps) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = isControlled ? (onOpenChange ?? (() => {})) : setInternalOpen;

  const [pending, startTransition] = React.useTransition();
  const [type, setType] = React.useState<ReminderType>(
    leadId ? "whatsapp" : "other",
  );
  const [remindAt, setRemindAt] = React.useState(toLocalDateTimeInputValue());

  function onSubmit(formData: FormData) {
    const title = String(formData.get("title") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim();
    if (!title) {
      toast.error("Title is required");
      return;
    }

    startTransition(async () => {
      const result = await createReminder({
        organisation_id: organisationId,
        lead_id: leadId ?? undefined,
        title,
        notes: notes.length ? notes : undefined,
        remind_at: fromLocalDateTimeInput(remindAt),
        type,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Reminder scheduled");
      setOpen(false);
      router.refresh();
      // Reset for next open
      setType(leadId ? "whatsapp" : "other");
      setRemindAt(toLocalDateTimeInputValue());
    });
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger render={trigger} /> : null}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlusIcon className="size-4" />
            New reminder
          </DialogTitle>
          <DialogDescription>
            {leadName
              ? `Schedule a follow-up for ${leadName}.`
              : "Schedule a follow-up for your team."}
          </DialogDescription>
        </DialogHeader>
        <form action={onSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              name="title"
              placeholder="Follow up on pricing"
              required
              maxLength={200}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as ReminderType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="remind_at">When</Label>
              <Input
                id="remind_at"
                type="datetime-local"
                value={remindAt}
                onChange={(e) => setRemindAt(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              name="notes"
              placeholder="Context for your future self…"
              rows={3}
              maxLength={2000}
            />
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : null}
              {pending ? "Scheduling…" : "Schedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
