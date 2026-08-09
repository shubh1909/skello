"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { SectionLabel } from "@/components/app/section-label";
import { saveCodSettings } from "@/actions/cod-confirmation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { CodSettings } from "@/types/cod";

interface Props {
  settings: CodSettings | null;
  connected: boolean;
}

export function CodConfirmationSettingsForm({ settings, connected }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);

  // Start/Stop lives in the header controls — settings preserves the running
  // state so saving timing never flips it. The confirmation voice agent is
  // configured on the admin side (Shopify config), not here.
  const enabled = settings?.enabled ?? false;
  const [waitMinutes, setWaitMinutes] = React.useState(
    String(settings?.wait_minutes ?? 15),
  );
  const [maxAttempts, setMaxAttempts] = React.useState(
    String(settings?.max_attempts ?? 3),
  );
  const [retryMinutes, setRetryMinutes] = React.useState(
    String(Math.round((settings?.retry_interval_seconds ?? 1800) / 60)),
  );
  const [windowStart, setWindowStart] = React.useState(
    settings?.call_window_start?.slice(0, 5) ?? "",
  );
  const [windowEnd, setWindowEnd] = React.useState(
    settings?.call_window_end?.slice(0, 5) ?? "",
  );
  const [gateways, setGateways] = React.useState(
    (settings?.cod_gateway_names ?? []).join(", "),
  );

  function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (Boolean(windowStart) !== Boolean(windowEnd)) {
      toast.error(
        "Set both a start and end time for the calling window, or leave both blank to call any time.",
      );
      return;
    }
    startTransition(async () => {
      const res = await saveCodSettings({
        enabled,
        wait_minutes: Number(waitMinutes),
        max_attempts: Number(maxAttempts),
        retry_interval_seconds: Number(retryMinutes) * 60,
        call_window_start: windowStart || null,
        call_window_end: windowEnd || null,
        cod_gateway_names: gateways
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s !== ""),
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("COD confirmation settings saved");
      router.refresh();
    });
  }

  return (
    <Card className="p-5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between py-1 text-left"
      >
        <SectionLabel as="span">
          Settings
        </SectionLabel>
        <ChevronDownIcon
          className={cn(
            "size-8 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <form onSubmit={onSave} className="mt-4 flex flex-col gap-5">
          {!connected ? (
            <p className="text-xs text-muted-foreground">
              Connect Shopify first to configure COD confirmation.
            </p>
          ) : null}

          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="cod-wait">Wait before calling (minutes)</Label>
              <Input
                id="cod-wait"
                type="number"
                min={1}
                max={1440}
                value={waitMinutes}
                onChange={(e) => setWaitMinutes(e.target.value)}
                disabled={pending}
              />
              <p className="text-xs text-muted-foreground">
                Measured from when the order is placed.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cod-attempts">Max call attempts</Label>
              <Input
                id="cod-attempts"
                type="number"
                min={1}
                max={10}
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(e.target.value)}
                disabled={pending}
              />
              <p className="text-xs text-muted-foreground">
                Only retried when the call doesn&apos;t connect.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cod-retry">Gap between attempts (minutes)</Label>
              <Input
                id="cod-retry"
                type="number"
                min={1}
                max={1440}
                value={retryMinutes}
                onChange={(e) => setRetryMinutes(e.target.value)}
                disabled={pending}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Calling window (IST)</Label>
            <div className="flex flex-wrap items-center gap-3">
              <Input
                type="time"
                aria-label="Calling window start"
                value={windowStart}
                onChange={(e) => setWindowStart(e.target.value)}
                disabled={pending}
                className="w-auto"
              />
              <span className="text-sm text-muted-foreground">to</span>
              <Input
                type="time"
                aria-label="Calling window end"
                value={windowEnd}
                onChange={(e) => setWindowEnd(e.target.value)}
                disabled={pending}
                className="w-auto"
              />
              {windowStart || windowEnd ? (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setWindowStart("");
                    setWindowEnd("");
                  }}
                  disabled={pending}
                  className="text-muted-foreground"
                >
                  Clear
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Customers are only called within this window (times in IST). A call
              due outside it waits until the window next opens. Leave both blank
              to call any time.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="cod-gateways">
              COD payment methods{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              id="cod-gateways"
              placeholder="e.g. Cash on Delivery (COD), GoKwik COD"
              value={gateways}
              onChange={(e) => setGateways(e.target.value)}
              disabled={pending}
            />
            <p className="text-xs text-muted-foreground">
              Optional. Comma-separated payment-method names, exactly as your
              store reports them, that count as Cash on Delivery. Leave blank to
              auto-detect any method whose name contains &ldquo;cash on
              delivery&rdquo; or &ldquo;COD&rdquo;.
            </p>
          </div>

          <div className="flex items-center justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : null}
              Save settings
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
