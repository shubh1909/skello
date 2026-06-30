import "server-only";

import type { ShopifyOfferOption } from "@/types/shopify";
import type { ShopifyWebhookTopic } from "@/lib/shopify/webhooks";

// Minimal typed Admin API client for one store. Holds the per-org credentials;
// every call is authenticated with that store's access token.
export class ShopifyApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ShopifyApiError";
  }
}

interface ShopifyClientConfig {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
}

function baseUrl(cfg: ShopifyClientConfig): string {
  return `https://${cfg.shopDomain}/admin/api/${cfg.apiVersion}`;
}

async function request<T>(
  cfg: ShopifyClientConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${baseUrl(cfg)}${path}`, {
    method,
    headers: {
      "X-Shopify-Access-Token": cfg.accessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ShopifyApiError(
      res.status,
      text.slice(0, 300) || `Shopify returned ${res.status}`,
    );
  }
  return (await res.json()) as T;
}

// Idempotent at the call level isn't guaranteed by Shopify, so the registrar
// (below) checks listWebhooks first to avoid duplicate subscriptions.
async function createWebhook(
  cfg: ShopifyClientConfig,
  topic: ShopifyWebhookTopic,
  address: string,
): Promise<void> {
  await request(cfg, "POST", "/webhooks.json", {
    webhook: { topic, address, format: "json" },
  });
}

export interface ShopifyWebhookRow {
  id: number;
  topic: string;
  address: string;
}

export async function listShopifyWebhooks(
  cfg: ShopifyClientConfig,
): Promise<ShopifyWebhookRow[]> {
  const json = await request<{ webhooks?: ShopifyWebhookRow[] }>(
    cfg,
    "GET",
    "/webhooks.json",
  );
  return json.webhooks ?? [];
}

/**
 * Ensure every topic in `topics` is subscribed to `address`, skipping any that
 * already point there. Returns the topics it newly registered.
 */
export async function ensureWebhooks(
  cfg: ShopifyClientConfig,
  topics: readonly ShopifyWebhookTopic[],
  address: string,
): Promise<{ registered: ShopifyWebhookTopic[]; alreadyPresent: ShopifyWebhookTopic[] }> {
  const existing = await listShopifyWebhooks(cfg);
  const present = new Set(
    existing
      .filter((w) => w.address === address)
      .map((w) => w.topic),
  );

  const registered: ShopifyWebhookTopic[] = [];
  const alreadyPresent: ShopifyWebhookTopic[] = [];
  for (const topic of topics) {
    if (present.has(topic)) {
      alreadyPresent.push(topic);
      continue;
    }
    await createWebhook(cfg, topic, address);
    registered.push(topic);
  }
  return { registered, alreadyPresent };
}

interface PriceRuleRow {
  id: number;
  title: string;
  // Shopify stores the discount as a negative string, e.g. "-10.0".
  value?: string | null;
  value_type?: string | null;
}

// Offer source for the picker: price rules (discount campaigns) on the store.
// Best-effort — used to help the org pick an offer; manual entry still works.
// We also surface the numeric value + kind so the recovery agent can quote a
// real discounted cart total.
export async function listDiscountOffers(
  cfg: ShopifyClientConfig,
): Promise<ShopifyOfferOption[]> {
  const json = await request<{ price_rules?: PriceRuleRow[] }>(
    cfg,
    "GET",
    "/price_rules.json?limit=50",
  );
  return (json.price_rules ?? []).map((r) => {
    const kind =
      r.value_type === "percentage" || r.value_type === "fixed_amount"
        ? r.value_type
        : null;
    // value arrives negative ("-10.0") — magnitude is the discount.
    const raw = r.value != null ? Math.abs(Number(r.value)) : NaN;
    return {
      id: String(r.id),
      title: r.title,
      value: kind && Number.isFinite(raw) ? raw : null,
      valueType: kind,
    };
  });
}

interface DiscountCodeRow {
  id: number;
  code: string;
}

// The redeemable code(s) live on a price rule's child resource — a rule can own
// several, but recovery only needs one to read out. Returns the first code, or
// null for an automatic discount (price rule with no codes).
export async function getDiscountCodeForRule(
  cfg: ShopifyClientConfig,
  priceRuleId: string,
): Promise<string | null> {
  const json = await request<{ discount_codes?: DiscountCodeRow[] }>(
    cfg,
    "GET",
    `/price_rules/${encodeURIComponent(priceRuleId)}/discount_codes.json`,
  );
  const code = json.discount_codes?.[0]?.code;
  return typeof code === "string" && code.trim() !== "" ? code.trim() : null;
}
