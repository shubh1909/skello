"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon, Loader2Icon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import {
  disconnectShopify,
  getRegisteredWebhooks,
  registerShopifyWebhooks,
  saveShopifyIntegration,
} from "@/actions/admin/shopify";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ShopifyIntegrationStatus } from "@/types/shopify";

const DEFAULT_API_VERSION = "2025-04";

interface Props {
  organisationId: string;
  status: ShopifyIntegrationStatus | null;
}

export function ShopifyConnectForm({ organisationId, status }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const [shopDomain, setShopDomain] = React.useState(status?.shop_domain ?? "");
  const [clientId, setClientId] = React.useState("");
  const [apiSecret, setApiSecret] = React.useState("");
  const [apiVersion, setApiVersion] = React.useState(
    status?.api_version ?? DEFAULT_API_VERSION,
  );
  const [webhooks, setWebhooks] = React.useState<
    { topic: string; address: string }[] | null
  >(null);
  // Which button triggered the shared transition — so only that button shows a
  // spinner (the `pending` flag is shared across all actions).
  const [activeAction, setActiveAction] = React.useState<
    "save" | "register" | "show" | "disconnect" | null
  >(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!shopDomain.trim() || !clientId.trim() || !apiSecret.trim()) {
      toast.error("Store domain, API key, and API secret are all required");
      return;
    }
    setActiveAction("save");
    startTransition(async () => {
      const res = await saveShopifyIntegration({
        organisation_id: organisationId,
        shop_domain: shopDomain.trim(),
        client_id: clientId.trim(),
        api_secret: apiSecret.trim(),
        api_version: apiVersion.trim(),
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setApiSecret(""); // write-only
      toast.success("Credentials saved — now click Authorize with Shopify");
      router.refresh();
    });
  }

  function onRegisterWebhooks() {
    setActiveAction("register");
    startTransition(async () => {
      const res = await registerShopifyWebhooks({
        organisation_id: organisationId,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      const { registered, alreadyPresent } = res.data;
      toast.success(
        registered.length > 0
          ? `Registered ${registered.length} webhook(s)`
          : `All ${alreadyPresent.length} webhooks already registered`,
      );
    });
  }

  function onShowWebhooks() {
    setActiveAction("show");
    startTransition(async () => {
      const res = await getRegisteredWebhooks({
        organisation_id: organisationId,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setWebhooks(res.data);
    });
  }

  function onDisconnect() {
    if (
      !confirm(
        "Disconnect this store? Cart-recovery calls will stop until it's reconnected.",
      )
    ) {
      return;
    }
    setActiveAction("disconnect");
    startTransition(async () => {
      const res = await disconnectShopify({ organisation_id: organisationId });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setShopDomain("");
      setClientId("");
      setApiVersion(DEFAULT_API_VERSION);
      toast.success("Shopify store disconnected");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {status?.authorized ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2Icon className="size-4 text-emerald-600" />
            <span>
              Connected &amp; authorized:{" "}
              <span className="font-mono font-medium">{status.shop_domain}</span>{" "}
              <Badge variant="secondary" className="ml-1">
                API {status.api_version}
              </Badge>
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onRegisterWebhooks}
              disabled={pending}
            >
              Register webhooks
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onShowWebhooks}
              disabled={pending}
            >
              Show webhooks
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onDisconnect}
              disabled={pending}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2Icon className="size-4" /> Disconnect
            </Button>
          </div>
        </div>
      ) : status ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <div className="text-sm">
            Credentials saved for{" "}
            <span className="font-mono font-medium">{status.shop_domain}</span> —
            authorize the store to finish.
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              disabled={pending}
              render={
                <a href={`/api/shopify/install?organisation_id=${organisationId}`} />
              }
            >
              Authorize with Shopify
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onDisconnect}
              disabled={pending}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2Icon className="size-4" /> Remove
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          Not connected yet. In the client&apos;s Shopify app, add this
          workspace&apos;s callback URL{" "}
          <code>/api/shopify/oauth/callback</code> to the app&apos;s allowed
          redirect URLs and enable the cart-recovery scopes. Then paste the
          app&apos;s <span className="font-medium text-foreground">API key</span>{" "}
          and{" "}
          <span className="font-medium text-foreground">API secret key</span>{" "}
          below, save, and click{" "}
          <span className="font-medium text-foreground">Authorize</span>.
        </div>
      )}

      {webhooks ? (
        <div className="rounded-lg border border-border/60 p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Registered webhooks ({webhooks.length})
          </p>
          {webhooks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              None yet — click “Register webhooks”.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {webhooks.map((w, i) => (
                <li key={`${w.topic}-${i}`} className="flex flex-col">
                  <code className="text-xs font-medium">{w.topic}</code>
                  <span className="break-all font-mono text-[11px] text-muted-foreground">
                    {w.address}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <form
        onSubmit={onSubmit}
        className="grid gap-4 rounded-lg border border-border/60 bg-muted/20 p-4"
      >
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {status ? "Update credentials" : "Store credentials"}
        </p>
        <div className="grid gap-1.5">
          <Label htmlFor="shop-domain">Store domain</Label>
          <Input
            id="shop-domain"
            placeholder="your-store.myshopify.com"
            value={shopDomain}
            onChange={(e) => setShopDomain(e.target.value)}
            disabled={pending}
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-[11px] text-muted-foreground">
            The permanent <code>.myshopify.com</code> domain (Settings → Domains),
            not the public storefront URL.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="client-id">API key (Client ID)</Label>
            <Input
              id="client-id"
              placeholder="the app's API key / client ID"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={pending}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="api-secret">API secret key</Label>
            <Input
              id="api-secret"
              type="password"
              placeholder={status ? "•••••••• (re-enter to update)" : "shpss_…"}
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              disabled={pending}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>

        <div className="grid gap-1.5 md:max-w-48">
          <Label htmlFor="api-version">API version</Label>
          <Input
            id="api-version"
            placeholder="2025-04"
            value={apiVersion}
            onChange={(e) => setApiVersion(e.target.value)}
            disabled={pending}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="flex items-center justify-end">
          <Button type="submit" disabled={pending}>
            {pending && activeAction === "save" ? (
              <Loader2Icon className="animate-spin" />
            ) : null}
            Save credentials
          </Button>
        </div>
      </form>
    </div>
  );
}
