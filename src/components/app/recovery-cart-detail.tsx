"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AttemptStatusBadge,
  CallStatusBadge,
  CartOutcomeBadge,
  MessageStatusBadge,
  WhatsAppSentBadge,
} from "@/components/app/recovery-badges";
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

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
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
            <WhatsAppSentBadge status={cart.whatsapp_status} />
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
            <Field
              label="Attempts"
              value={`${cart.attempt}/${cart.max_attempts}`}
            />
          </div>

          <div className="grid grid-cols-2 gap-4 border-t pt-4">
            <Field
              label="Abandoned"
              value={formatDateTime(cart.abandoned_at ?? cart.created_at)}
            />
            <Field label="Recorded" value={formatDateTime(cart.created_at)} />
            {cart.status === "pending" ? (
              <Field
                label="Next call"
                value={formatDateTime(cart.next_attempt_at)}
              />
            ) : null}
            <Field
              label="WhatsApp sent"
              value={formatDateTime(cart.whatsapp_sent_at)}
            />
            <Field label="Recovered" value={formatDateTime(cart.converted_at)} />
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
              <ul className="flex flex-col gap-2">
                {messages.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-card px-3 py-2"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm">
                        {m.template_name ?? "template"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(m.sent_at ?? m.created_at)}
                        {m.error_message ? ` · ${m.error_message}` : ""}
                      </span>
                    </div>
                    <MessageStatusBadge status={m.status} />
                  </li>
                ))}
              </ul>
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
