import "server-only";

import { pooledMap } from "@/lib/campaigns/dispatch";
import { logSkeloError } from "@/lib/errors";
import { resolveShopifyIntegrationByShop } from "@/lib/shopify/integration";
import { scheduleRecoveryFromCheckout } from "@/lib/shopify/recovery";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ShopifyIntegration } from "@/types/shopify";

// =============================================================================
// CHECKOUT RECEIPT LOG — make a checkouts/* delivery survive us.
// =============================================================================
// The webhook records every delivery in shopify_checkout_events BEFORE acking
// Shopify, then schedules the recovery from next/after(). If that scheduling
// dies — a DB blip, a thrown handler, or pm2 replacing the process mid-callback
// — the receipt is still on disk and this drainer replays it on the next cron
// tick. See 20260806000000_shopify_checkout_events.sql for the full rationale.
//
// Normally the drainer finds nothing: the inline attempt marks the row processed
// within milliseconds. It earns its keep only on the bad days.
// =============================================================================

type Admin = ReturnType<typeof createAdminClient>;

const CHECKOUT_EVENT_MAX_ATTEMPTS = 5;
const CHECKOUT_EVENT_BATCH = 50;
// Groups are independent (one per checkout); rows within a group run in order.
const CHECKOUT_EVENT_CONCURRENCY = 10;
// Don't replay an event the inline after() callback may still be working on.
// Anything younger than this had its chance and is presumed in-flight.
const CHECKOUT_EVENT_CLAIM_GRACE_MS = 60_000;
// The payload holds shopper PII, so processed receipts are pruned. Long enough
// to investigate a lag complaint from last week, short enough not to hoard.
const CHECKOUT_EVENT_RETENTION_DAYS = 14;

const EVENT_COLUMNS =
  "id, organisation_id, shop_domain, topic, checkout_token, payload, attempts";

interface CheckoutEventRow {
  id: string;
  organisation_id: string;
  shop_domain: string;
  topic: string;
  checkout_token: string | null;
  payload: unknown;
  attempts: number;
}

// Shopify's checkout token, read defensively — the payload is untyped and a
// missing token only costs us the denormalised column, never the receipt.
// Exported for tests: both readers run on unverified provider input.
export function readCheckoutToken(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const token = (payload as Record<string, unknown>).token;
  return typeof token === "string" && token.trim() !== "" ? token.trim() : null;
}

// X-Shopify-Triggered-At. Rejected rather than stored when unparseable, so the
// lag report can trust every non-null value.
export function parseTriggeredAt(header: string | null): string | null {
  if (!header) return null;
  const at = new Date(header);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

export interface RecordCheckoutEventInput {
  integration: ShopifyIntegration;
  topic: string;
  webhookId: string | null;
  triggeredAtHeader: string | null;
  payload: unknown;
}

/**
 * Persist a verified checkouts/* delivery. Call this BEFORE acking Shopify, and
 * let it throw: a receipt we failed to write must become a non-2xx so Shopify
 * redelivers. Returns null when Shopify is retrying an event we already hold
 * (unique on organisation_id + webhook_id), so the caller can skip the work.
 */
export async function recordCheckoutEvent(
  input: RecordCheckoutEventInput,
): Promise<{ eventId: string | null; duplicate: boolean }> {
  const admin = createAdminClient();

  // ON CONFLICT DO NOTHING — .select() yields a row only when WE inserted it.
  const { data, error } = await admin
    .from("shopify_checkout_events")
    .upsert(
      {
        organisation_id: input.integration.organisation_id,
        shop_domain: input.integration.shop_domain,
        topic: input.topic,
        webhook_id: input.webhookId,
        checkout_token: readCheckoutToken(input.payload),
        triggered_at: parseTriggeredAt(input.triggeredAtHeader),
        payload: input.payload,
      },
      { onConflict: "organisation_id,webhook_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) throw new Error(error.message);
  return { eventId: data?.id ?? null, duplicate: !data };
}

/**
 * Has this checkout already turned into an order? Only asked on REPLAY, where
 * minutes or hours may have passed since the delivery: scheduling from a stale
 * payload would create a fresh pending attempt for a shopper who has since paid,
 * and then dial them. The inline path doesn't need it — its payload is seconds
 * old, and scheduleRecoveryFromCheckout already bails on a settled attempt row.
 */
async function alreadyOrdered(
  admin: Admin,
  organisationId: string,
  checkoutToken: string | null,
): Promise<boolean> {
  if (!checkoutToken) return false;
  const [byCheckout, byCart] = await Promise.all([
    admin
      .from("shopify_order_events")
      .select("id")
      .eq("organisation_id", organisationId)
      .eq("checkout_token", checkoutToken)
      .limit(1),
    admin
      .from("shopify_order_events")
      .select("id")
      .eq("organisation_id", organisationId)
      .eq("cart_token", checkoutToken)
      .limit(1),
  ]);
  return (byCheckout.data?.length ?? 0) > 0 || (byCart.data?.length ?? 0) > 0;
}

async function markProcessed(
  admin: Admin,
  eventId: string,
  attempts: number,
): Promise<void> {
  await admin
    .from("shopify_checkout_events")
    .update({
      processed_at: new Date().toISOString(),
      attempts: attempts + 1,
      last_error: null,
    })
    .eq("id", eventId);
}

async function markFailed(
  admin: Admin,
  eventId: string,
  attempts: number,
  err: unknown,
): Promise<void> {
  // processed_at stays null so the tick replays it, until attempts runs out.
  await admin
    .from("shopify_checkout_events")
    .update({
      attempts: attempts + 1,
      last_error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
    })
    .eq("id", eventId);
}

/**
 * Schedule the recovery for one recorded event and stamp the outcome on it.
 * Throws on failure (after recording it) so the caller can log; the receipt is
 * left unprocessed for the next tick either way.
 */
async function processCheckoutEvent(
  admin: Admin,
  row: CheckoutEventRow,
  integration: ShopifyIntegration,
  isReplay: boolean,
): Promise<void> {
  try {
    if (isReplay && (await alreadyOrdered(admin, row.organisation_id, row.checkout_token))) {
      // Converted while the receipt sat here. Nothing to schedule, and calling
      // now would harass a paying customer — settle it as done.
      await markProcessed(admin, row.id, row.attempts);
      return;
    }
    await scheduleRecoveryFromCheckout({
      integration,
      payload: row.payload,
    });
    await markProcessed(admin, row.id, row.attempts);
  } catch (err) {
    await markFailed(admin, row.id, row.attempts, err);
    throw err;
  }
}

/**
 * Handle a freshly recorded delivery, inline, from next/after(). Never throws —
 * the receipt is already durable, so the tick is the safety net.
 */
export async function processRecordedCheckoutEvent(input: {
  eventId: string;
  integration: ShopifyIntegration;
  topic: string;
  payload: unknown;
}): Promise<void> {
  const admin = createAdminClient();
  try {
    await processCheckoutEvent(
      admin,
      {
        id: input.eventId,
        organisation_id: input.integration.organisation_id,
        shop_domain: input.integration.shop_domain,
        topic: input.topic,
        checkout_token: readCheckoutToken(input.payload),
        payload: input.payload,
        attempts: 0,
      },
      input.integration,
      false,
    );
  } catch (err) {
    logSkeloError("SHOPIFY", "Checkout scheduling failed; queued for replay", {
      shop: input.integration.shop_domain,
      topic: input.topic,
      eventId: input.eventId,
      cause: err,
    });
  }
}

/**
 * Replay checkout receipts whose scheduling never completed. Runs on the cron
 * tick. Rows for the same checkout are replayed in arrival order so a stale
 * payload can't overwrite newer cart context.
 */
export async function drainPendingCheckoutEvents(): Promise<{
  replayed: number;
  failed: number;
  pruned: number;
}> {
  const admin = createAdminClient();

  const cutoff = new Date(
    Date.now() - CHECKOUT_EVENT_CLAIM_GRACE_MS,
  ).toISOString();

  const { data } = await admin
    .from("shopify_checkout_events")
    .select(EVENT_COLUMNS)
    .is("processed_at", null)
    .lt("attempts", CHECKOUT_EVENT_MAX_ATTEMPTS)
    .lt("received_at", cutoff)
    .order("received_at", { ascending: true })
    .limit(CHECKOUT_EVENT_BATCH)
    .returns<CheckoutEventRow[]>();

  const rows = data ?? [];
  const pruned = await pruneProcessedCheckoutEvents(admin);
  if (rows.length === 0) return { replayed: 0, failed: 0, pruned };

  // One group per checkout: ordering matters within a group, not across them.
  const groups = new Map<string, CheckoutEventRow[]>();
  for (const row of rows) {
    const key = row.checkout_token ?? `event:${row.id}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  // Resolved once per shop, not once per event.
  const integrations = new Map<string, ShopifyIntegration | null>();
  const resolve = async (shop: string): Promise<ShopifyIntegration | null> => {
    const cached = integrations.get(shop);
    if (cached !== undefined) return cached;
    const found = await resolveShopifyIntegrationByShop(shop);
    integrations.set(shop, found);
    return found;
  };

  let replayed = 0;
  let failed = 0;

  await pooledMap(
    [...groups.values()],
    CHECKOUT_EVENT_CONCURRENCY,
    async (group) => {
      for (const row of group) {
        const integration = await resolve(row.shop_domain);
        if (!integration || !integration.enabled) {
          // Store disconnected since. Nothing to schedule and nothing to fix —
          // burn an attempt so it ages out instead of retrying forever.
          await markFailed(admin, row.id, row.attempts, "integration_disabled");
          failed += 1;
          continue;
        }
        try {
          await processCheckoutEvent(admin, row, integration, true);
          replayed += 1;
        } catch (err) {
          failed += 1;
          logSkeloError("SHOPIFY", "Checkout event replay failed", {
            shop: row.shop_domain,
            topic: row.topic,
            eventId: row.id,
            attempts: row.attempts + 1,
            cause: err,
          });
          // Later events for this checkout would write older context on top of
          // newer; stop this group and let the next tick resume in order.
          break;
        }
      }
    },
  );

  return { replayed, failed, pruned };
}

// Processed receipts carry shopper PII and no ongoing value. Unprocessed rows are
// never pruned — a stuck receipt is evidence.
async function pruneProcessedCheckoutEvents(admin: Admin): Promise<number> {
  const cutoff = new Date(
    Date.now() - CHECKOUT_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data } = await admin
    .from("shopify_checkout_events")
    .delete()
    .not("processed_at", "is", null)
    .lt("processed_at", cutoff)
    .select("id")
    .returns<Array<{ id: string }>>();
  return data?.length ?? 0;
}
