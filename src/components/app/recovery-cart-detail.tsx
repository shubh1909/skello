"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";

import {
  AttemptStatusBadge,
  CartOutcomeBadge,
  WhatsAppSentBadge,
} from "@/components/app/recovery-badges";
import { CallSplitView } from "@/components/app/call-detail";
import {
  DescriptionList,
  DetailPanel,
  DetailSheetPanel,
  DetailSheetShell,
  DetailTimeline,
  type TimelineEvent,
} from "@/components/app/detail-sheet";
import {
  WhatsAppClickStep,
  WhatsAppMessageTimeline,
} from "@/components/app/whatsapp-timeline";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  getRecoveryCallsForAttempt,
  getRecoveryMessagesForAttempt,
} from "@/actions/shopify-recovery";
import { useClientNow } from "@/hooks/use-client-now";
import { resolveE164 } from "@/lib/phone";
import { dialCodeForCountry } from "@/lib/phone-countries";
import {
  formatDateTime,
  formatMoney,
  productsSummary,
} from "@/lib/format/recovery";
import type {
  RecoveryAttemptRow,
  RecoveryCallRow,
  RecoveryMessageRow,
} from "@/types/shopify";

/**
 * Cart-level detail drawer — one abandoned cart (recovery attempt): its shopper,
 * cart and offer, its lifecycle, and the calls and messages we sent.
 *
 * Clicking a call used to open a SECOND drawer on top of this one, which hid
 * the cart you opened it from and made comparing two calls a
 * close-and-reopen. The Calls tab is now the same rail + pane the lead sheet
 * uses, at the same `lg` width.
 */
export function RecoveryCartDetail({
  cart,
  open,
  onOpenChange,
}: {
  cart: RecoveryAttemptRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [calls, setCalls] = React.useState<RecoveryCallRow[] | null>(null);
  const [messages, setMessages] = React.useState<RecoveryMessageRow[] | null>(
    null,
  );
  const [selectedCallId, setSelectedCallId] = React.useState<string | null>(
    null,
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const now = useClientNow();

  const cartId = cart?.id ?? null;
  React.useEffect(() => {
    if (!open || !cartId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setCalls(null);
      setMessages(null);
      setSelectedCallId(null);
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
      // Preselect the most recent call so the pane is never empty on arrival.
      setSelectedCallId(callsRes.data[0]?.id ?? null);
      if (msgRes.success) setMessages(msgRes.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, cartId]);

  if (!cart) return null;

  const shopper = cart.customer_name ?? cart.email ?? "Unknown shopper";
  const products = productsSummary(cart.cart_items);

  // How this cart's number actually resolves — the same pure function the
  // dispatchers run, so what's shown here is what was dialled and messaged, not
  // a second guess at it.
  const dialled = resolveE164(cart.phone, dialCodeForCountry(cart.phone_country));

  // The lifecycle, in order. Labels are rewritten to say WHOSE clock each one
  // is on — that ambiguity is why the old grid needed a tooltip per row.
  const timeline: TimelineEvent[] = [
    {
      label: "Abandoned at checkout",
      at: cart.abandoned_at ?? cart.created_at,
      display: formatDateTime(cart.abandoned_at ?? cart.created_at),
    },
    {
      label: "Webhook received",
      at: cart.created_at,
      display: formatDateTime(cart.created_at),
    },
    {
      label: "WhatsApp sent",
      at: cart.whatsapp_sent_at,
      display: formatDateTime(cart.whatsapp_sent_at),
    },
    {
      label: "Link clicked",
      at: cart.clicked_at,
      display: formatDateTime(cart.clicked_at),
    },
    {
      label: "Order matched",
      at: cart.converted_at,
      display: formatDateTime(cart.converted_at),
      // Kept as a hint because it IS genuinely non-obvious: a phone match will
      // never reconcile with Shopify's own "recovered" figure, and someone
      // comparing the two dashboards needs to know why.
      hint:
        cart.converted_at && cart.conversion_match
          ? cart.conversion_match === "token"
            ? "Matched by checkout/cart token — Shopify attributes this the same way, so it shows as recovered there too."
            : "Matched by phone; the order carried no tokens (GoKwik / custom checkout). Shopify shows it as a plain order, never 'recovered'."
          : undefined,
    },
    {
      label: "Next call",
      at: cart.status === "pending" ? cart.next_attempt_at : null,
      display: formatDateTime(cart.next_attempt_at),
      upcoming: true,
    },
  ];

  return (
    <DetailSheetShell
      open={open}
      onOpenChange={onOpenChange}
      // `lg`, matching the lead sheet: the Calls tab is a two-pane rail and
      // detail, which does not fit in `md`.
      width="lg"
      title={shopper}
      description="Abandoned cart details"
      subtitle={
        <span className="font-mono tabular-nums">
          {cart.phone ?? "no phone"}
        </span>
      }
      pills={
        <>
          <CartOutcomeBadge
            convertedAt={cart.converted_at}
            outcome={cart.recovery_outcome}
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
        </>
      }
      tabs={[
        { value: "summary", label: "Summary" },
        { value: "calls", label: "Calls", count: calls?.length },
        { value: "whatsapp", label: "WhatsApp", count: messages?.length },
      ]}
    >
      <DetailSheetPanel value="summary">
        <DetailPanel title="Cart">
          {/* omitEmpty is safe here: every one of these is a fact about the
              cart, and an absent offer is genuinely nothing to report. The
              items array is filtered BEFORE layout, so the columns can't
              reshuffle the way the old null-returning Field made them. */}
          <DescriptionList
            omitEmpty
            columns={2}
            items={[
              { label: "Email", value: cart.email },
              {
                label: "Cart value",
                value: formatMoney(cart.cart_total, cart.currency),
              },
              { label: "Offer", value: cart.offer_label },
              { label: "Discount code", value: cart.offer_code, mono: true },
              // Snapshotted per attempt — what the agent was told to SAY on
              // this call, not necessarily today's setting.
              { label: "Agent says", value: cart.offer_code_spoken },
              {
                label: "Attempts",
                value: `${cart.attempt}/${cart.max_attempts}`,
              },
              // Only shown when the payload carried an address country, and
              // only interesting next to the number we actually used.
              { label: "Address country", value: cart.phone_country },
              { label: "Dialled as", value: dialled.e164, mono: true },
              { label: "Products", value: products.full, span: "full" },
            ]}
          />

          {/* The one case where we knowingly ignore data the payload gave us.
              A 10-digit number is a valid Indian mobile AND a valid national
              number in several other markets, so the shape cannot settle it —
              we prefer the home market and say so, rather than dial a country
              the voice provider would reject outright. */}
          {dialled.hintOverridden ? (
            <Alert variant="warning" className="mt-3">
              <AlertTitle>Address country not used</AlertTitle>
              <AlertDescription>
                The checkout address said{" "}
                <span className="font-medium">{cart.phone_country}</span> (+
                {dialled.hint}), but the number is a valid home-market number,
                so it was contacted as{" "}
                <span className="font-mono">{dialled.e164}</span>. If this
                shopper really is abroad, that call and message went to the
                wrong number.
              </AlertDescription>
            </Alert>
          ) : null}
        </DetailPanel>

        <DetailPanel title="Lifecycle">
          <DetailTimeline events={timeline} />
        </DetailPanel>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </DetailSheetPanel>

      {/* `fill` is required: the split view owns its own scrolling on each
          side, and without it the panel scrolls too — two nested scrollbars
          and a rail that drifts out of view. */}
      <DetailSheetPanel value="calls" fill>
        <CallSplitView
          calls={calls}
          selectedId={selectedCallId}
          onSelect={setSelectedCallId}
          counterpartyName={cart.customer_name}
          now={now}
          emptyLabel="No calls placed for this cart yet."
        />
      </DetailSheetPanel>

      <DetailSheetPanel value="whatsapp">
        {loading ? (
          <LoadingRow label="Loading messages…" />
        ) : messages && messages.length > 0 ? (
          <>
            {messages.map((m) => (
              <WhatsAppMessageTimeline key={m.id} message={m} />
            ))}
            {/* Cart-level, so it sits after the messages rather than inside
                one: the short link belongs to the ATTEMPT, and when retries
                sent several messages we can't say which was clicked. */}
            <WhatsAppClickStep clickedAt={cart.clicked_at} />
          </>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No WhatsApp messages</EmptyTitle>
              <EmptyDescription>
                Nothing has been sent to this cart yet. Messages appear here once
                the recovery run picks it up.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </DetailSheetPanel>
    </DetailSheetShell>
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
      <Loader2Icon className="size-4 animate-spin" />
      {label}
    </div>
  );
}
