"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, MessageCircleIcon, SendIcon } from "lucide-react";
import { toast } from "sonner";

import { toggleLeadContactedOnWhatsApp } from "@/actions/leads";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
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
import { buildWaUrl, normalisePhoneForWa } from "@/lib/format";
import type { Lead } from "@/types/lead";

interface WhatsAppDialogProps {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TEMPLATES = [
  { id: "intro", label: "Friendly intro" },
  { id: "followup", label: "Follow-up nudge" },
  { id: "demo", label: "Demo invite" },
  { id: "custom", label: "Custom" },
] as const;

type TemplateId = (typeof TEMPLATES)[number]["id"];

function templateText(id: TemplateId, lead: Lead | null): string {
  const name = lead?.name?.split(" ")[0] ?? "there";
  const product = lead?.product ?? "your enquiry";
  switch (id) {
    case "intro":
      return `Hi ${name}, this is the team at Skello — thanks for reaching out about ${product}. Is now a good time to chat?`;
    case "followup":
      return `Hey ${name}, just circling back on ${product}. Happy to answer anything that's on your mind.`;
    case "demo":
      return `Hi ${name} — I'd love to show you how Skello can help with ${product}. Are you free for a quick 15-min walkthrough this week?`;
    case "custom":
      return "";
  }
}

export function WhatsAppDialog({
  lead,
  open,
  onOpenChange,
}: WhatsAppDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  // Parent passes key={lead?.id} so this component remounts per lead.
  const [template, setTemplate] = React.useState<TemplateId>("intro");
  const [phone, setPhone] = React.useState(lead?.phone ?? "");
  const [message, setMessage] = React.useState(() =>
    templateText("intro", lead),
  );

  function onTemplateChange(value: string | null) {
    if (!value) return;
    const t = value as TemplateId;
    setTemplate(t);
    if (t !== "custom") setMessage(templateText(t, lead));
  }

  const normalised = normalisePhoneForWa(phone);
  const phoneValid = normalised.length >= 8 && normalised.length <= 15;

  function onSend() {
    if (!lead) return;
    if (!phoneValid) {
      toast.error("Add a valid phone number first");
      return;
    }
    const url = buildWaUrl(phone, message);
    window.open(url, "_blank", "noopener,noreferrer");

    if (!lead.contacted_on_watsapp) {
      startTransition(async () => {
        const result = await toggleLeadContactedOnWhatsApp(lead.id);
        if (result.success) {
          toast.success("Marked as contacted on WhatsApp");
          router.refresh();
        }
      });
    } else {
      toast.success("WhatsApp opened");
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircleIcon className="size-4 text-emerald-600" />
            Message {lead?.name ?? "lead"} on WhatsApp
          </DialogTitle>
          <DialogDescription>
            We&apos;ll open a wa.me link in a new tab. The lead will be marked as
            contacted.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="wa-phone">Phone number</Label>
            <Input
              id="wa-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98xxxxxxxx"
              inputMode="tel"
              autoComplete="tel"
              aria-invalid={!phoneValid && phone.length > 0}
            />
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">
                Stored: {lead?.phone ?? "—"}
              </span>
              <span
                className={
                  phoneValid
                    ? "text-muted-foreground"
                    : phone
                      ? "text-destructive"
                      : "text-muted-foreground"
                }
              >
                {phoneValid
                  ? `wa.me/${normalised}`
                  : phone
                    ? "Add country code, digits only count"
                    : "Required"}
              </span>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Template</Label>
            <Select value={template} onValueChange={onTemplateChange}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATES.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="wa-message">Message</Label>
            <Textarea
              id="wa-message"
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                if (template !== "custom") setTemplate("custom");
              }}
              rows={5}
              placeholder="Write a friendly opener…"
            />
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{message.length} chars</span>
              {lead?.contacted_on_watsapp ? (
                <Badge variant="secondary">Already contacted</Badge>
              ) : null}
            </div>
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>
            Cancel
          </DialogClose>
          <Button onClick={onSend} disabled={pending || !phoneValid}>
            {pending ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <SendIcon />
            )}
            Open WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
