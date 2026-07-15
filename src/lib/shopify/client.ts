import "server-only";

import type { ShopifyDiscountKind, ShopifyOfferOption } from "@/types/shopify";
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

// GraphQL Admin API call. Discounts (and other modern resources) only live in
// GraphQL — the legacy REST PriceRule resource misses new-engine / app-created
// discounts. Note: GraphQL returns HTTP 200 even for query errors, so we must
// inspect the `errors` array explicitly.
async function graphql<T>(
  cfg: ShopifyClientConfig,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${baseUrl(cfg)}/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": cfg.accessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ShopifyApiError(
      res.status,
      text.slice(0, 300) || `Shopify returned ${res.status}`,
    );
  }
  const json = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (json.errors && json.errors.length > 0) {
    throw new ShopifyApiError(
      200,
      json.errors.map((e) => e.message).join("; ").slice(0, 300),
    );
  }
  if (!json.data) throw new ShopifyApiError(200, "GraphQL returned no data");
  return json.data;
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

// One page of active code discounts. We ask GraphQL to filter to `status:active`
// server-side, and pull the code + value inline so the picker needs no follow-up
// call. Covers ALL code-discount types (basic / BXGY / free shipping / app) —
// crucially including new-engine discounts the legacy REST price_rules misses.
const ACTIVE_CODE_DISCOUNTS_QUERY = `
query ActiveCodeDiscounts($cursor: String) {
  codeDiscountNodes(first: 100, after: $cursor, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      codeDiscount {
        __typename
        ... on DiscountCodeBasic {
          title
          codes(first: 1) { nodes { code } }
          customerGets {
            value {
              __typename
              ... on DiscountPercentage { percentage }
              ... on DiscountAmount { amount { amount } }
            }
          }
        }
        ... on DiscountCodeBxgy { title codes(first: 1) { nodes { code } } }
        ... on DiscountCodeFreeShipping { title codes(first: 1) { nodes { code } } }
        ... on DiscountCodeApp { title codes(first: 1) { nodes { code } } }
      }
    }
  }
}`;

interface DiscountValueNode {
  __typename?: string;
  percentage?: number;
  amount?: { amount?: string | null } | null;
}

interface CodeDiscountNode {
  id: string;
  codeDiscount: {
    __typename: string;
    title?: string | null;
    codes?: { nodes?: Array<{ code?: string | null }> } | null;
    customerGets?: { value?: DiscountValueNode | null } | null;
  } | null;
}

interface CodeDiscountsData {
  codeDiscountNodes: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: CodeDiscountNode[];
  };
}

// Map a Shopify discount value to our (value, kind). Percentage arrives as a
// fraction (0.2 = 20%) — we store whole percentages. BXGY / free-shipping have
// no scalar value, so the agent can read the code but can't quote a total.
function extractDiscountValue(v: DiscountValueNode | null | undefined): {
  value: number | null;
  valueType: ShopifyDiscountKind | null;
} {
  if (!v) return { value: null, valueType: null };
  if (v.__typename === "DiscountPercentage" && typeof v.percentage === "number") {
    return {
      value: Math.round(v.percentage * 100 * 100) / 100,
      valueType: "percentage",
    };
  }
  if (v.__typename === "DiscountAmount" && v.amount?.amount != null) {
    const n = Number(v.amount.amount);
    return Number.isFinite(n)
      ? { value: n, valueType: "fixed_amount" }
      : { value: null, valueType: null };
  }
  return { value: null, valueType: null };
}

// Offer source for the picker: ACTIVE code discounts on the store, via GraphQL.
// Best-effort — manual entry still works. Pages through results (cursor-based),
// bounded so a pathological store can't loop forever. Codeless (automatic)
// discounts are skipped — recovery needs a code the agent can read out.
export async function listDiscountOffers(
  cfg: ShopifyClientConfig,
): Promise<ShopifyOfferOption[]> {
  const offers: ShopifyOfferOption[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < 20; page++) {
    const data: CodeDiscountsData = await graphql<CodeDiscountsData>(
      cfg,
      ACTIVE_CODE_DISCOUNTS_QUERY,
      { cursor },
    );
    const conn = data.codeDiscountNodes;
    for (const node of conn.nodes) {
      const d = node.codeDiscount;
      if (!d) continue;
      const code = d.codes?.nodes?.[0]?.code?.trim() || null;
      if (!code) continue; // active CODE discounts only
      const { value, valueType } = extractDiscountValue(d.customerGets?.value);
      offers.push({
        id: node.id,
        title: d.title?.trim() || code,
        code,
        value,
        valueType,
      });
    }
    if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) break;
    cursor = conn.pageInfo.endCursor;
  }

  return offers;
}
