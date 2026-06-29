"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import {
  listShopifyOffers,
  saveRecoverySettings,
} from "@/actions/shopify-recovery";
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
import type {
  ShopifyOfferOption,
  ShopifyOfferType,
  ShopifyRecoverySettings,
} from "@/types/shopify";

const OFFER_TYPE_LABEL: Record<string, string> = {
  none: "No offer",
  discount_code: "Discount code",
  free_product: "Free product",
};

interface Props {
  settings: ShopifyRecoverySettings | null;
  connected: boolean;
}

export function CartRecoverySettingsForm({ settings, connected }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const [enabled, setEnabled] = React.useState(settings?.enabled ?? false);
  const [waitMinutes, setWaitMinutes] = React.useState(
    String(settings?.wait_minutes ?? 45),
  );
  const [maxAttempts, setMaxAttempts] = React.useState(
    String(settings?.max_attempts ?? 2),
  );
  const [retryMinutes, setRetryMinutes] = React.useState(
    String(Math.round((settings?.retry_interval_seconds ?? 1800) / 60)),
  );
  const [offerType, setOfferType] = React.useState<string>(
    settings?.offer_type ?? "none",
  );
  const [offerLabel, setOfferLabel] = React.useState(settings?.offer_label ?? "");
  const [offerCode, setOfferCode] = React.useState(settings?.offer_code ?? "");
  const [offers, setOffers] = React.useState<ShopifyOfferOption[]>([]);

  function onLoadOffers() {
    startTransition(async () => {
      const res = await listShopifyOffers();
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setOffers(res.data);
      toast.success(
        res.data.length > 0
          ? `Loaded ${res.data.length} offer(s) from Shopify`
          : "No discount campaigns found on the store",
      );
    });
  }

  function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveRecoverySettings({
        enabled,
        wait_minutes: Number(waitMinutes),
        max_attempts: Number(maxAttempts),
        retry_interval_seconds: Number(retryMinutes) * 60,
        offer_type: offerType as ShopifyOfferType,
        offer_label: offerType === "none" ? null : offerLabel.trim() || null,
        offer_code: offerType === "none" ? null : offerCode.trim() || null,
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
      <form onSubmit={onSave} className="flex flex-col gap-5">
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={pending || !connected}
            className="size-4 accent-foreground"
          />
          <span className="font-medium">Cart recovery is {enabled ? "on" : "off"}</span>
          {!connected ? (
            <span className="text-xs text-muted-foreground">
              (connect Shopify first)
            </span>
          ) : null}
        </label>

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

        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Offer on the call</Label>
            <Select
              value={offerType}
              onValueChange={(v) => v !== null && setOfferType(v)}
              disabled={pending}
            >
              <SelectTrigger>
                <SelectValue>{OFFER_TYPE_LABEL[offerType] ?? offerType}</SelectValue>
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

        {offerType !== "none" ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="offer-label">What the agent says</Label>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={onLoadOffers}
                  disabled={pending || !connected}
                >
                  Load from Shopify
                </Button>
              </div>
              <Input
                id="offer-label"
                list="shopify-offers"
                placeholder="e.g. 10% off your order"
                value={offerLabel}
                onChange={(e) => setOfferLabel(e.target.value)}
                disabled={pending}
              />
              <datalist id="shopify-offers">
                {offers.map((o) => (
                  <option key={o.id} value={o.title} />
                ))}
              </datalist>
            </div>
            {offerType === "discount_code" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="offer-code">Discount code</Label>
                <Input
                  id="offer-code"
                  placeholder="e.g. SAVE10"
                  value={offerCode}
                  onChange={(e) => setOfferCode(e.target.value)}
                  disabled={pending}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2Icon className="animate-spin" /> : null}
            Save settings
          </Button>
        </div>
      </form>
    </Card>
  );
}
