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
import type { LeadIntent } from "@/types/lead";

const INTENTS: { value: LeadIntent; label: string }[] = [
  { value: "hot", label: "Hot" },
  { value: "warm", label: "warm" },
  { value: "cold", label: "Cold" },
];

export function LeadCreateDialog({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [intent, setIntent] = React.useState<LeadIntent>("warm");

  function onSubmit(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").trim();
    const product = String(formData.get("product") ?? "").trim();

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
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Lead added");
      setOpen(false);
      setIntent("warm");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <PlusIcon /> New lead
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a lead</DialogTitle>
          <DialogDescription>
            Capture a prospect manually. Bolna webhooks add inbound leads
            automatically.
          </DialogDescription>
        </DialogHeader>
        <form action={onSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="lead-name">Name</Label>
            <Input
              id="lead-name"
              name="name"
              placeholder="Jane Cooper"
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lead-phone">Phone</Label>
            <Input
              id="lead-phone"
              name="phone"
              type="tel"
              placeholder="+91 98xxxxxxxx"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="lead-product">Product</Label>
              <Input id="lead-product" name="product" placeholder="Pro plan" />
            </div>
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
