import { NextResponse, type NextRequest } from "next/server";

import { logSkeloError, warnSkelo } from "@/lib/errors";
import {
  normaliseGoogleAdsLead,
  parseGoogleAdsPayload,
} from "@/lib/intake/google-ads";
import { recordIntakeEvent, settleIntakeEvent } from "@/lib/intake/events";
import {
  credential,
  resolveIntakeSourceByToken,
  secretsMatch,
  touchIntakeSource,
} from "@/lib/intake/source";
import { ingestNormalisedLead } from "@/lib/leads/ingest";
import { checkRateLimit, tooManyRequestsResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Google Ads lead form webhook.
 *
 *   POST /api/webhooks/google-ads/<public_token>
 *
 * ⚠️ **The response contract is the INVERSE of Shopify's, and it is the one
 * thing here that must not be got wrong.**
 *
 *   200 {}                  accepted — Google forgets the delivery
 *   4XX {"message": "..."}  rejected — NEVER retried
 *   5XX {"message": "..."}  failed   — retried
 *
 * Our Shopify route deliberately 200-acks deliveries it can't use, so Shopify
 * stops retrying. Copying that reflex here would discard a real lead on a
 * transient database blip, permanently and silently. So: anything that is our
 * fault returns 5xx, and only a payload that can never succeed returns 4xx.
 *
 * Authentication is `google_key` — a plaintext shared secret echoed back in the
 * body. There is no signature. The token in the URL carries tenancy separately,
 * so a leaked key alone does not let an attacker choose whose workspace to
 * write to.
 *
 * Work is NOT deferred to `after()`. Google's contract lets us report failure
 * and be retried, which is strictly better than acking and hoping — the
 * opposite trade-off from Shopify's 5-second deadline.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // Keyed by token, not IP: Google posts from a wide range, and the per-tenant
  // bucket is the one that means anything here.
  const rl = await checkRateLimit({
    key: `google-ads-webhook:${token.slice(0, 64)}`,
    windowSeconds: 60,
    max: 600,
  });
  if (!rl.allowed) return tooManyRequestsResponse(rl.retryAfterSeconds);

  const source = await resolveIntakeSourceByToken(token, "google_ads");
  if (!source) {
    // Unknown or disabled — indistinguishable on purpose. 4xx because no retry
    // will ever make this work.
    return message(404, "Unknown lead intake endpoint");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return message(400, "Invalid JSON");
  }

  const payload = parseGoogleAdsPayload(body);
  if (!payload) {
    warnSkelo("WEBHOOK-INGEST", "Google Ads payload had no lead_id", {
      organisationId: source.organisation_id,
      sourceId: source.id,
    });
    return message(400, "Not a Google Ads lead payload");
  }

  const expectedKey = credential(source, "google_key");
  if (!expectedKey) {
    // Our own misconfiguration, not theirs. 5xx so Google retries — once the
    // key is filled in, the pending deliveries land instead of being lost.
    logSkeloError("WEBHOOK-INGEST", "Google Ads source has no google_key set", {
      organisationId: source.organisation_id,
      sourceId: source.id,
    });
    return message(503, "Endpoint not fully configured");
  }
  if (!secretsMatch(payload.google_key, expectedKey)) {
    warnSkelo("WEBHOOK-INGEST", "Google Ads key mismatch — delivery rejected", {
      organisationId: source.organisation_id,
      sourceId: source.id,
      keyPresent: Boolean(payload.google_key),
    });
    return message(401, "Invalid key");
  }

  // Durability before anything else. `lead_id` is the dedupe key because Google
  // does not promise exactly-once delivery.
  const recorded = await recordIntakeEvent({
    source,
    externalId: payload.lead_id,
    payload: body,
    status: payload.is_test ? "test" : "received",
  });

  if (recorded.kind === "duplicate") {
    return NextResponse.json({}, { status: 200 });
  }
  if (recorded.kind === "error") {
    // The one that matters: a 200 here would tell Google to forget a lead we
    // never stored.
    logSkeloError("WEBHOOK-INGEST", "Could not record Google Ads delivery", {
      organisationId: source.organisation_id,
      sourceId: source.id,
      cause: recorded.cause,
    });
    return message(503, "Could not record delivery");
  }

  // `last_event_at` is what the UI reads to say "connected" — stamp it even for
  // a test lead, because a test lead IS the proof the endpoint works.
  await touchIntakeSource(source.id);

  // Google fires one of these when the advertiser saves the form. It is the
  // onboarding "it works" signal, so it is recorded and shown — but it must not
  // become a lead in the pipeline.
  if (payload.is_test) {
    return NextResponse.json({}, { status: 200 });
  }

  const lead = normaliseGoogleAdsLead(payload, source.field_map ?? {});

  try {
    const { leadId } = await ingestNormalisedLead({
      organisationId: source.organisation_id,
      lead,
    });
    await settleIntakeEvent({
      eventId: recorded.eventId,
      status: "processed",
      leadId,
    });
    return NextResponse.json({}, { status: 200 });
  } catch (err) {
    // The receipt is already durable, so this is recoverable by replay even if
    // Google gives up. Still a 5xx: a retry is the cheapest fix available.
    logSkeloError("WEBHOOK-INGEST", "Google Ads lead ingest failed", {
      organisationId: source.organisation_id,
      sourceId: source.id,
      cause: err,
    });
    await settleIntakeEvent({
      eventId: recorded.eventId,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    return message(503, "Could not ingest lead");
  }
}

/** Google's documented error body shape. */
function message(status: number, text: string): NextResponse {
  return NextResponse.json({ message: text }, { status });
}
