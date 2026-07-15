"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import {
  listShopifyOffers,
  saveRecoverySettings,
} from "@/actions/shopify-recovery";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { RECOVERY_TEMPLATE_LAYOUTS } from "@/lib/shopify/recovery-templates";
import type {
  RecoveryTemplateLayout,
  ShopifyDiscountKind,
  ShopifyOfferOption,
  ShopifyOfferType,
  ShopifyRecoverySettings,
} from "@/types/shopify";

const OFFER_TYPE_LABEL: Record<string, string> = {
  none: "No offer",
  discount_code: "Discount code",
  free_product: "Free product",
};

// Human label for a price rule's discount value (badge in the dropdown).
function discountBadge(o: ShopifyOfferOption): string | null {
  if (o.value == null || !o.valueType) return null;
  return o.valueType === "percentage" ? `${o.value}% off` : `${o.value} off`;
}

interface Props {
  settings: ShopifyRecoverySettings | null;
  connected: boolean;
}

export function CartRecoverySettingsForm({ settings, connected }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);

  // Start/Stop lives in the dashboard controls now — settings just preserves the
  // current running state so saving the offer/timing never flips it.
  const enabled = settings?.enabled ?? false;
  const [waitMinutes, setWaitMinutes] = React.useState(
    String(settings?.wait_minutes ?? 45),
  );
  const [maxAttempts, setMaxAttempts] = React.useState(
    String(settings?.max_attempts ?? 2),
  );
  const [retryMinutes, setRetryMinutes] = React.useState(
    String(Math.round((settings?.retry_interval_seconds ?? 1800) / 60)),
  );
  // Calling window (IST). DB stores "HH:MM:SS"; <input type="time"> wants "HH:MM".
  const [windowStart, setWindowStart] = React.useState(
    settings?.call_window_start?.slice(0, 5) ?? "",
  );
  const [windowEnd, setWindowEnd] = React.useState(
    settings?.call_window_end?.slice(0, 5) ?? "",
  );
  // Channels.
  const [voiceEnabled, setVoiceEnabled] = React.useState(
    settings?.voice_enabled ?? true,
  );
  const [whatsappEnabled, setWhatsappEnabled] = React.useState(
    settings?.whatsapp_enabled ?? false,
  );
  const [whatsappTemplate, setWhatsappTemplate] = React.useState(
    settings?.whatsapp_template_name ?? "",
  );
  const [whatsappLayout, setWhatsappLayout] =
    React.useState<RecoveryTemplateLayout>(
      settings?.whatsapp_template_layout ?? "coupon_link",
    );
  const [offerType, setOfferType] = React.useState<string>(
    settings?.offer_type ?? "none",
  );
  const [offerLabel, setOfferLabel] = React.useState(
    settings?.offer_label ?? "",
  );
  const [offerCode, setOfferCode] = React.useState(settings?.offer_code ?? "");
  const [offers, setOffers] = React.useState<ShopifyOfferOption[]>([]);
  const [loadingOffers, setLoadingOffers] = React.useState(false);
  const [selectedOfferId, setSelectedOfferId] = React.useState<string>("");
  // Numeric discount behind the offer — seeded from saved settings, then bound
  // to whichever Shopify price rule the operator selects below.
  const [discountValue, setDiscountValue] = React.useState<number | null>(
    settings?.offer_discount_value ?? null,
  );
  const [discountKind, setDiscountKind] =
    React.useState<ShopifyDiscountKind | null>(
      settings?.offer_discount_kind ?? null,
    );

  const loadOffers = React.useCallback(() => {
    setLoadingOffers(true);
    startTransition(async () => {
      const res = await listShopifyOffers();
      setLoadingOffers(false);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setOffers(res.data);
      if (res.data.length === 0) {
        toast.info("No discount campaigns found on the store");
      }
    });
  }, []);

  // Auto-load the store's discounts the first time a code offer is configured.
  const autoLoaded = React.useRef(false);
  React.useEffect(() => {
    if (
      connected &&
      offerType === "discount_code" &&
      !autoLoaded.current &&
      offers.length === 0
    ) {
      autoLoaded.current = true;
      loadOffers();
    }
  }, [connected, offerType, offers.length, loadOffers]);

  // Picking a discount binds its value/kind and auto-fills the redeemable code
  // (carried inline on the offer) plus a friendly spoken label.
  function onSelectOffer(id: string) {
    const offer = offers.find((o) => o.id === id);
    if (!offer) return;
    setSelectedOfferId(id);
    setDiscountValue(offer.value);
    setDiscountKind(offer.valueType);
    if (offer.valueType === "percentage" && offer.value != null) {
      setOfferLabel(`${offer.value}% off your order`);
    } else if (offer.valueType === "fixed_amount" && offer.value != null) {
      setOfferLabel(`${offer.value} off your order`);
    } else {
      setOfferLabel(offer.title);
    }
    setOfferCode(offer.code ?? "");
  }

  const discountHint =
    offerType !== "none" && discountValue != null && discountKind
      ? discountKind === "percentage"
        ? `Discount detected: ${discountValue}% off — the agent will quote the discounted total.`
        : `Discount detected: ${discountValue} off — the agent will quote the discounted total.`
      : null;

  function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (Boolean(windowStart) !== Boolean(windowEnd)) {
      toast.error(
        "Set both a start and end time for the calling window, or leave both blank to call any time.",
      );
      return;
    }
    startTransition(async () => {
      const res = await saveRecoverySettings({
        enabled,
        wait_minutes: Number(waitMinutes),
        max_attempts: Number(maxAttempts),
        retry_interval_seconds: Number(retryMinutes) * 60,
        call_window_start: windowStart || null,
        call_window_end: windowEnd || null,
        voice_enabled: voiceEnabled,
        whatsapp_enabled: whatsappEnabled,
        whatsapp_template_name: whatsappTemplate.trim() || null,
        whatsapp_template_layout: whatsappLayout,
        offer_type: offerType as ShopifyOfferType,
        offer_label: offerType === "none" ? null : offerLabel.trim() || null,
        offer_code: offerType === "none" ? null : offerCode.trim() || null,
        offer_discount_value: offerType === "none" ? null : discountValue,
        offer_discount_kind: offerType === "none" ? null : discountKind,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Recovery settings saved");
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
        <span className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Settings
        </span>
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
              Connect Shopify first to configure recovery.
            </p>
          ) : null}

          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="wait">Wait before calling (minutes)</Label>
              <Input
                id="wait"
                type="number"
                min={1}
                max={1440}
                value={waitMinutes}
                onChange={(e) => setWaitMinutes(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="attempts">Max call attempts</Label>
              <Input
                id="attempts"
                type="number"
                min={1}
                max={10}
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="retry">Gap between attempts (minutes)</Label>
              <Input
                id="retry"
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
              Shoppers are only called within this window (times in IST). A call
              due outside it waits until the window next opens. Leave both blank
              to call any time.
            </p>
          </div>

          <div className="grid gap-3 rounded-md border border-border/60 p-4">
            <span className="text-sm font-medium">Channels</span>
            <div className="flex flex-wrap gap-5">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={voiceEnabled}
                  onChange={(e) => setVoiceEnabled(e.target.checked)}
                  disabled={pending}
                  className="size-4 accent-foreground"
                />
                Voice call
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={whatsappEnabled}
                  onChange={(e) => setWhatsappEnabled(e.target.checked)}
                  disabled={pending}
                  className="size-4 accent-foreground"
                />
                WhatsApp
              </label>
            </div>

            {voiceEnabled && whatsappEnabled ? (
              <p className="text-xs text-muted-foreground">
                The voice agent calls first. WhatsApp is sent as soon as the
                connected call ends — or as a fallback if the call never
                connects.
              </p>
            ) : null}

            {whatsappEnabled ? (
              <div className="grid gap-1.5">
                <Label>Message style</Label>
                <Select
                  value={whatsappLayout}
                  onValueChange={(v) =>
                    v && setWhatsappLayout(v as RecoveryTemplateLayout)
                  }
                  disabled={pending}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.keys(
                        RECOVERY_TEMPLATE_LAYOUTS,
                      ) as RecoveryTemplateLayout[]
                    ).map((key) => (
                      <SelectItem key={key} value={key}>
                        {RECOVERY_TEMPLATE_LAYOUTS[key].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {RECOVERY_TEMPLATE_LAYOUTS[whatsappLayout].description} Point
                  the template name below at a Meta template with the matching
                  variable count.
                </p>
              </div>
            ) : null}

            {whatsappEnabled ? (
              <div className="grid gap-1.5">
                <Label htmlFor="wa-template-override">
                  WhatsApp template (optional override)
                </Label>
                <Input
                  id="wa-template-override"
                  placeholder="Leave blank to use the connected default"
                  value={whatsappTemplate}
                  onChange={(e) => setWhatsappTemplate(e.target.value)}
                  disabled={pending}
                />
                <p className="text-xs text-muted-foreground">
                  The Meta-approved template name. Blank uses the one set on the
                  WhatsApp connection in Settings.
                </p>
              </div>
            ) : null}

            {whatsappEnabled && offerType === "none" ? (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                No discount offer is set, so the offer fields (discount code,
                discounted total) in the WhatsApp template will be blank. If your
                approved template references them, pick an offer below — or use a
                template without discount variables — otherwise the message reads
                oddly and some providers reject the send.
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Offer on the call</Label>
              <Select
                value={offerType}
                onValueChange={(v) => v !== null && setOfferType(v)}
                disabled={pending}
              >
                <SelectTrigger>
                  <SelectValue>
                    {OFFER_TYPE_LABEL[offerType] ?? offerType}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(OFFER_TYPE_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {offerType === "discount_code" ? (
            <div className="flex flex-col gap-4">
              {/* Pick the underlying Shopify discount — drives the code + % math. */}
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="shopify-discount">Shopify discount</Label>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      autoLoaded.current = true;
                      loadOffers();
                    }}
                    disabled={pending || !connected}
                    className="gap-1.5 text-muted-foreground"
                  >
                    <RefreshCwIcon
                      className={loadingOffers ? "animate-spin" : undefined}
                    />
                    Refresh
                  </Button>
                </div>
                <Select
                  value={selectedOfferId}
                  onValueChange={(v) => v && onSelectOffer(v)}
                  disabled={pending || !connected || offers.length === 0}
                >
                  <SelectTrigger id="shopify-discount">
                    <SelectValue
                      placeholder={
                        loadingOffers
                          ? "Loading discounts…"
                          : offers.length === 0
                            ? "No discounts found on the store"
                            : "Select a discount campaign"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {offers.map((o) => {
                      const badge = discountBadge(o);
                      return (
                        <SelectItem key={o.id} value={o.id}>
                          <span className="flex w-full items-center justify-between gap-3">
                            <span className="truncate">{o.title}</span>
                            {badge ? (
                              <Badge variant="secondary">{badge}</Badge>
                            ) : null}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {discountHint ? (
                  <p className="text-xs text-muted-foreground">
                    {discountHint}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Pick a percentage discount so the agent can quote the
                    savings.
                  </p>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
                <div className="grid gap-1.5">
                  <Label htmlFor="offer-label" className="whitespace-nowrap">
                    What the agent says
                  </Label>
                  <Input
                    id="offer-label"
                    placeholder="e.g. 20% off your order"
                    value={offerLabel}
                    onChange={(e) => setOfferLabel(e.target.value)}
                    disabled={pending}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="offer-code" className="whitespace-nowrap">
                    Discount code
                  </Label>
                  <Input
                    id="offer-code"
                    placeholder="e.g. COMEBACK20"
                    value={offerCode}
                    onChange={(e) => setOfferCode(e.target.value)}
                    disabled={pending}
                  />
                  <p className="text-xs text-muted-foreground">
                    Auto-filled from the selected discount; edit if your code
                    differs.
                  </p>
                </div>
              </div>
            </div>
          ) : offerType === "free_product" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="offer-label-fp">What the agent says</Label>
                <Input
                  id="offer-label-fp"
                  placeholder="e.g. a free gift with your order"
                  value={offerLabel}
                  onChange={(e) => setOfferLabel(e.target.value)}
                  disabled={pending}
                />
              </div>
            </div>
          ) : null}

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
