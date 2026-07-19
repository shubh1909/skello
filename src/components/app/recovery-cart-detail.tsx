"use client";

import * as React from "react";
import { InfoIcon, Loader2Icon } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AttemptStatusBadge,
  CallStatusBadge,
  CartOutcomeBadge,
  WhatsAppSentBadge,
} from "@/components/app/recovery-badges";
import {
  WhatsAppClickStep,
  WhatsAppMessageTimeline,
} from "@/components/app/whatsapp-timeline";
import {
  getRecoveryCallsForAttempt,
  getRecoveryMessagesForAttempt,
} from "@/actions/shopify-recovery";
import {
  formatDateTime,
  formatDuration,
  formatMoney,
  productsSummary,
} from "@/lib/format/recovery";
import type {
  RecoveryAttemptRow,
  RecoveryCallRow,
  RecoveryMessageRow,
} from "@/types/shopify";

function Field({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  // Fuller explanation on hover — used to disambiguate the several timestamps
  // (checkout time vs our receipt time vs order time) that otherwise look alike.
  hint?: string;
}) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground">
        {label}
        {hint ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={`About ${label}`}
                  className="inline-flex cursor-help text-muted-foreground/60 hover:text-foreground"
                />
              }
            >
              <InfoIcon className="size-3" />
            </TooltipTrigger>
            {/* max-w-xs on TooltipContent wraps the text to a readable column
                instead of the browser's full-width native title. */}
            <TooltipContent className="max-w-[16rem] leading-snug">
              {hint}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

// Cart-level detail drawer. Mirrors the call-history drawer but keyed to one
// abandoned cart (recovery attempt): its shopper + cart + offer, plus the full
// call history for that cart. Clicking a call opens the per-call drawer.
export function RecoveryCartDetail({
  cart,
  open,
  onOpenChange,
  onOpenCall,
}: {
  cart: RecoveryAttemptRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenCall: (call: RecoveryCallRow) => void;
}) {
  const [calls, setCalls] = React.useState<RecoveryCallRow[] | null>(null);
  const [messages, setMessages] = React.useState<RecoveryMessageRow[] | null>(
    null,
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const cartId = cart?.id ?? null;
  React.useEffect(() => {
    if (!open || !cartId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setCalls(null);
      setMessages(null);
      const [callsRes, msgRes] = await Promise.all([
        getRecoveryCallsForAttempt(cartId),
        getRecoveryMessagesForAttempt(cartId),
      ]);
      if (cancelled) return;
      setLoading(false);
      if (!callsRes.success) {
        setError(callsRes.error);
        return;
      }
      setCalls(callsRes.data);
      if (msgRes.success) setMessages(msgRes.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, cartId]);

  if (!cart) return null;
  const shopper = cart.customer_name ?? cart.email ?? "Unknown shopper";
  const products = productsSummary(cart.cart_items);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="gap-1 border-b">
          <SheetTitle>{shopper}</SheetTitle>
          <SheetDescription className="font-mono tabular-nums">
            {cart.phone ?? "no phone"}
          </SheetDescription>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <CartOutcomeBadge
              convertedAt={cart.converted_at}
              attributed={cart.attributed}
            />
            <AttemptStatusBadge status={cart.status} />
            {cart.status === "skipped" && cart.skip_reason ? (
              <span className="text-[11px] text-muted-foreground">
                {cart.skip_reason.replace(/_/g, " ")}
              </span>
            ) : null}
            <WhatsAppSentBadge
              status={cart.whatsapp_status}
              reason={cart.whatsapp_skip_reason}
            />
          </div>
        </SheetHeader>

        <div className="flex flex-col gap-5 p-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Email" value={cart.email} />
            <Field
              label="Cart value"
              value={formatMoney(cart.cart_total, cart.currency)}
            />
            <Field label="Products" value={products.full || "—"} />
            <Field label="Offer" value={cart.offer_label} />
            <Field label="Discount code" value={cart.offer_code} />
            {/* Snapshotted per attempt — what the agent was told to SAY on this
                call, which is not necessarily today's setting. */}
            {cart.offer_code_spoken ? (
              <Field label="Agent says" value={cart.offer_code_spoken} />
            ) : null}
            <Field
              label="Attempts"
              value={`${cart.attempt}/${cart.max_attempts}`}
            />
          </div>

          <div className="grid grid-cols-2 gap-4 border-t pt-4">
            <Field
              label="Checkout started"
              hint="When the shopper reached checkout in Shopify. This is Shopify's checkout timestamp — it should match the store."
              value={formatDateTime(cart.abandoned_at ?? cart.created_at)}
            />
            <Field
              label="Received by us"
              hint="When our system received the checkout webhook — a few moments after the checkout. This is our receipt time, not a Shopify time."
              value={formatDateTime(cart.created_at)}
            />
            {cart.status === "pending" ? (
              <Field
                label="Next call"
                hint="When the next recovery call is scheduled (in the store's timezone)."
                value={formatDateTime(cart.next_attempt_at)}
              />
            ) : null}
            <Field
              label="WhatsApp sent"
              hint="When we handed the WhatsApp message to the provider."
              value={formatDateTime(cart.whatsapp_sent_at)}
            />
            <Field
              label="Marked recovered"
              hint="When we recorded the matching order (≈ the order time in Shopify)."
              value={formatDateTime(cart.converted_at)}
            />
            {cart.converted_at && cart.conversion_match ? (
              <Field
                label="Matched by"
                hint={
                  cart.conversion_match === "token"
                    ? "Matched to the order by checkout/cart token — Shopify attributes this the same way, so it also shows as recovered in Shopify."
                    : "Matched by phone because the order carried no tokens (GoKwik / custom checkout). Shopify can't attribute these — it shows a plain order, never 'recovered'."
                }
                value={
                  cart.conversion_match === "token"
                    ? "Order token · Shopify agrees"
                    : "Phone · GoKwik-style"
                }
              />
            ) : null}
          </div>

          <div className="flex flex-col gap-2 border-t pt-4">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              Call history
            </span>
            {loading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
                Loading calls…
              </div>
            ) : error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : calls && calls.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {calls.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onOpenCall(c)}
                      className="flex w-full items-center justify-between gap-3 rounded-md border border-border/60 bg-card px-3 py-2 text-left transition-colors hover:bg-muted/40"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="text-sm">
                          {formatDateTime(c.started_at ?? c.created_at)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDuration(c.duration_seconds)}
                          {c.call_outcome ? ` · ${c.call_outcome}` : ""}
                        </span>
                      </div>
                      <CallStatusBadge status={c.status} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No calls placed for this cart yet.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t pt-4">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              WhatsApp
            </span>
            {loading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
                Loading messages…
              </div>
            ) : messages && messages.length > 0 ? (
              <div className="flex flex-col gap-2">
                {messages.map((m) => (
                  <WhatsAppMessageTimeline key={m.id} message={m} />
                ))}
                <WhatsAppClickStep clickedAt={cart.clicked_at} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No WhatsApp messages for this cart yet.
              </p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
