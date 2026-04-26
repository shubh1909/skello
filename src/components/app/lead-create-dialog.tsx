"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { createLead } from "@/actions/leads";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { LeadIntent, LeadStatus } from "@/types/lead";

const INTENTS: { value: LeadIntent; label: string }[] = [
  { value: "hot", label: "Hot" },
  { value: "warm", label: "Warm" },
  { value: "cold", label: "Cold" },
];

const STATUSES: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "negotiating", label: "Negotiating" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

export function LeadCreateDialog({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [intent, setIntent] = React.useState<LeadIntent>("warm");
  const [status, setStatus] = React.useState<LeadStatus>("new");

  function resetForm() {
    setIntent("warm");
    setStatus("new");
  }

  function onSubmit(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").trim();
    const product = String(formData.get("product") ?? "").trim();
    const city = String(formData.get("city") ?? "").trim();
    const pincode = String(formData.get("pincode") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim();

    if (!name) {
      toast.error("Name is required");
      return;
    }

    startTransition(async () => {
      const result = await createLead({
        org_slug: orgSlug,
        name,
        phone: phone || undefined,
        product: product || undefined,
        lead_intent: intent,
        status,
        // Anything captured through this dialog is manual by definition.
        source: "manual",
        city: city || undefined,
        pincode: pincode || undefined,
        notes: notes || undefined,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Lead added");
      setOpen(false);
      resetForm();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger
        render={
          <Button>
            <PlusIcon /> New lead
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a lead</DialogTitle>
          <DialogDescription>
            Capture a prospect manually. Inbound calls add leads
            automatically.
          </DialogDescription>
        </DialogHeader>
        <form action={onSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="lead-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="lead-name"
              name="name"
              placeholder="Jane Cooper"
              required
              maxLength={200}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="lead-phone">Phone</Label>
              <Input
                id="lead-phone"
                name="phone"
                type="tel"
                placeholder="+91 98xxxxxxxx"
                maxLength={32}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lead-product">Product</Label>
              <Input
                id="lead-product"
                name="product"
                placeholder="Pro plan"
                maxLength={500}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Intent</Label>
              <Select
                value={intent}
                onValueChange={(v) => setIntent(v as LeadIntent)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTENTS.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as LeadStatus)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="lead-city">City</Label>
              <Input
                id="lead-city"
                name="city"
                placeholder="Mumbai"
                maxLength={100}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lead-pincode">Pincode</Label>
              <Input
                id="lead-pincode"
                name="pincode"
                placeholder="400001"
                maxLength={20}
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="lead-notes">Notes</Label>
            <Textarea
              id="lead-notes"
              name="notes"
              placeholder="Context from the conversation, preferences, objections…"
              rows={3}
              maxLength={5000}
            />
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : null}
              {pending ? "Saving…" : "Save lead"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
