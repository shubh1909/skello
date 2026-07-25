"use client";

import * as React from "react";
import { Loader2Icon, PhoneCallIcon } from "lucide-react";
import { toast } from "sonner";

import { testCodAgentCall } from "@/actions/cod-confirmation";
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

// Client-side mirror of the server E.164 check for an inline error.
const E164 = /^\+[1-9]\d{6,14}$/;

// Dummy context the agent's {placeholders} resolve to on the demo call.
const DEFAULTS = {
  customer_name: "Rahul",
  order_name: "#1001",
  order_total: "1499",
  currency: "INR",
};

export function CodTestAgentDialog({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" type="button" disabled={disabled}>
            <PhoneCallIcon /> Test agent
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Test COD confirmation agent</DialogTitle>
          <DialogDescription>
            Place a one-off call using your COD confirmation agent. The values
            below are sent as context to the agent — the same variables a real
            Cash-on-Delivery order would provide. This dial is flagged as a test:
            it doesn&apos;t touch a lead, an order, or your stats.
          </DialogDescription>
        </DialogHeader>

        {open ? <CodTestAgentBody onClose={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CodTestAgentBody({ onClose }: { onClose: () => void }) {
  const [toPhone, setToPhone] = React.useState("");
  const [customerName, setCustomerName] = React.useState(DEFAULTS.customer_name);
  const [orderName, setOrderName] = React.useState(DEFAULTS.order_name);
  const [orderTotal, setOrderTotal] = React.useState(DEFAULTS.order_total);
  const [currency, setCurrency] = React.useState(DEFAULTS.currency);
  const [dialing, setDialing] = React.useState(false);

  const toValid = E164.test(toPhone.trim());
  const toError =
    toPhone.length > 0 && !toValid ? "Use E.164, e.g. +14155551234" : null;
  const canDial = toValid && !dialing;

  async function onDial() {
    if (!canDial) return;
    setDialing(true);
    try {
      const res = await testCodAgentCall({
        to_phone: toPhone.trim(),
        customer_name: customerName,
        order_name: orderName,
        order_total: orderTotal,
        currency,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(`Dialling ${res.data.dialed}…`);
      onClose();
    } finally {
      setDialing(false);
    }
  }

  return (
    <>
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="cod-test-to">Call to</Label>
          <Input
            id="cod-test-to"
            type="tel"
            inputMode="tel"
            placeholder="+14155551234"
            value={toPhone}
            onChange={(e) => setToPhone(e.target.value)}
            disabled={dialing}
            aria-invalid={Boolean(toError)}
            className="font-mono"
          />
          {toError ? (
            <p className="text-xs text-destructive">{toError}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              A real phone to receive the demo call. Include the country code.
            </p>
          )}
        </div>

        <div className="rounded-md border border-border/60 p-3">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Context sent to the agent
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="cod-test-name">customer_name</Label>
              <Input
                id="cod-test-name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                disabled={dialing}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cod-test-order">order_name</Label>
              <Input
                id="cod-test-order"
                value={orderName}
                onChange={(e) => setOrderName(e.target.value)}
                disabled={dialing}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cod-test-total">order_total</Label>
              <Input
                id="cod-test-total"
                inputMode="numeric"
                value={orderTotal}
                onChange={(e) => setOrderTotal(e.target.value)}
                disabled={dialing}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cod-test-currency">currency</Label>
              <Input
                id="cod-test-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                disabled={dialing}
              />
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Only the customer&apos;s first name is spoken. These map to the
            <code className="mx-1 text-foreground">{"{placeholder}"}</code>
            variables in the agent script.
          </p>
        </div>
      </div>

      <DialogFooter>
        <DialogClose
          render={<Button variant="outline" type="button" disabled={dialing} />}
        >
          Cancel
        </DialogClose>
        <Button type="button" onClick={onDial} disabled={!canDial}>
          {dialing ? (
            <Loader2Icon className="animate-spin" />
          ) : (
            <PhoneCallIcon />
          )}
          {dialing ? "Dialling…" : "Place test call"}
        </Button>
      </DialogFooter>
    </>
  );
}
