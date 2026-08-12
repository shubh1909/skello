import { NextResponse, after, type NextRequest } from "next/server";

import { logSkeloError, warnSkelo } from "@/lib/errors";
import { recordIntakeEvent, settleIntakeEvent } from "@/lib/intake/events";
import {
  credential,
  resolveIntakeSourceByToken,
  secretsMatch,
  touchIntakeSource,
} from "@/lib/intake/source";
import {
  normaliseWhatsAppLead,
  parseWhatsAppWebhook,
  verifyMetaSignature,
  type WhatsAppInboundMessage,
} from "@/lib/intake/whatsapp";
import { ingestNormalisedLead, leadExistsForPhone } from "@/lib/leads/ingest";
import { checkRateLimit, tooManyRequestsResponse } from "@/lib/rate-limit";

export const runtime = "nodejs"; // node:crypto + raw body
export const dynamic = "force-dynamic";

/**
 * WhatsApp Cloud API webhook — Click-to-WhatsApp lead capture.
 *
 *   GET  /api/webhooks/whatsapp/<public_token>   Meta's subscription handshake
 *   POST /api/webhooks/whatsapp/<public_token>   message events
 *
 * Direct to Meta rather than through a BSP, because the `referral` object
 * carrying the ad attribution does not reliably survive a provider's relay.
 * Each client runs their OWN Meta app, so the signing secret differs per org —
 * the tenant must be resolved from the URL token before the signature can be
 * checked. Resolve, then verify; the same order the Shopify route uses.
 */

/**
 * Meta's verification handshake, sent once when the webhook URL is saved.
 *
 * Echo `hub.challenge` as plain text and nothing else — Meta compares the body
 * byte for byte, so a JSON wrapper fails the subscription with no useful error.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const source = await resolveIntakeSourceByToken(token, "whatsapp");
  if (!source) return new NextResponse("Not found", { status: 404 });

  const sp = request.nextUrl.searchParams;
  const expected = credential(source, "verify_token");
  if (
    sp.get("hub.mode") !== "subscribe" ||
    !secretsMatch(sp.get("hub.verify_token"), expected)
  ) {
    warnSkelo("WEBHOOK-INGEST", "WhatsApp verification handshake rejected", {
      organisationId: source.organisation_id,
      sourceId: source.id,
      mode: sp.get("hub.mode"),
      verifyTokenConfigured: Boolean(expected),
    });
    return new NextResponse("Forbidden", { status: 403 });
  }

  return new NextResponse(sp.get("hub.challenge") ?? "", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const rl = await checkRateLimit({
    key: `whatsapp-webhook:${token.slice(0, 64)}`,
    windowSeconds: 60,
    max: 3000,
  });
  if (!rl.allowed) return tooManyRequestsResponse(rl.retryAfterSeconds);

  const source = await resolveIntakeSourceByToken(token, "whatsapp");
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Read the raw bytes ONCE. The signature is over exactly what was sent; a
  // parsed-and-re-serialised body loses key order and whitespace and will never
  // match.
  const rawBody = await request.text();

  const appSecret = credential(source, "app_secret");
  if (!appSecret) {
    logSkeloError("WEBHOOK-INGEST", "WhatsApp source has no app_secret set", {
      organisationId: source.organisation_id,
      sourceId: source.id,
    });
    // 5xx so Meta retries: this is our misconfiguration, and the messages are
    // recoverable once the secret is filled in.
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }
  if (
    !verifyMetaSignature(
      rawBody,
      request.headers.get("x-hub-signature-256"),
      appSecret,
    )
  ) {
    warnSkelo("WEBHOOK-INGEST", "WhatsApp signature verification failed", {
      organisationId: source.organisation_id,
      sourceId: source.id,
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = parseWhatsAppWebhook(body);

  // Delivery receipts, template status updates and account alerts all land on
  // this same subscription. None of them are leads; ack and move on.
  if (event.messages.length === 0) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // A phone number belongs to exactly one Meta app, so a mismatch means this
  // endpoint is wired to the wrong number — worth surfacing loudly, because
  // every lead would otherwise land in the wrong workspace.
  const configuredNumber = credential(source, "phone_number_id");
  if (
    configuredNumber &&
    event.phoneNumberId &&
    configuredNumber !== event.phoneNumberId
  ) {
    warnSkelo("WEBHOOK-INGEST", "WhatsApp delivery for an unexpected number", {
      organisationId: source.organisation_id,
      sourceId: source.id,
      expected: configuredNumber,
      received: event.phoneNumberId,
    });
    return NextResponse.json({ ok: true, ignored: "wrong_number" }, { status: 200 });
  }

  // Ack fast; Meta's retry window is generous but its timeout is not. Every
  // message is handled independently so one bad payload can't drop the rest.
  after(async () => {
    for (const message of event.messages) {
      try {
        await handleMessage(source, message, body);
      } catch (err) {
        logSkeloError("WEBHOOK-INGEST", "WhatsApp message ingest failed", {
          organisationId: source.organisation_id,
          sourceId: source.id,
          cause: err,
        });
      }
    }
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}

/**
 * One inbound message.
 *
 * **Ad-referred, or a first-time sender.** A `referral` object means they tapped
 * an ad — always a lead, even if we already know them, because responding to a
 * new campaign is new intent. Without one, only a number we've never seen
 * becomes a lead; a known customer's "hi" or a reply to a recovery message is
 * acked and dropped.
 *
 * Only messages we act on get a ledger row. WhatsApp traffic is mostly
 * conversation, and recording all of it would turn the delivery log into an
 * inbox nobody reads — with a raw payload attached to every line of it.
 */
async function handleMessage(
  source: Awaited<ReturnType<typeof resolveIntakeSourceByToken>>,
  message: WhatsAppInboundMessage,
  rawPayload: unknown,
): Promise<void> {
  if (!source) return;

  const fromAd = message.referral !== null;
  if (!fromAd) {
    const known = await leadExistsForPhone(source.organisation_id, message.from);
    if (known) return;
  }

  // Durability before work, and the dedupe gate: Meta redelivers on any non-2xx,
  // and `after()` runs where it can no longer hear us fail.
  const recorded = await recordIntakeEvent({
    source,
    externalId: message.wamid,
    payload: rawPayload,
  });
  if (recorded.kind === "duplicate") return;
  if (recorded.kind === "error") {
    logSkeloError("WEBHOOK-INGEST", "Could not record WhatsApp delivery", {
      organisationId: source.organisation_id,
      sourceId: source.id,
      cause: recorded.cause,
    });
    return;
  }

  await touchIntakeSource(source.id);

  try {
    const { leadId } = await ingestNormalisedLead({
      organisationId: source.organisation_id,
      lead: normaliseWhatsAppLead(message),
      options: {
        // The only name WhatsApp has is the sender's own display name — a shop
        // name or an emoji string as often as a person's. It seeds a new lead
        // but must never replace a name heard on a call.
        overwriteName: false,
        // Someone who was marked won or lost and has just tapped a new ad is a
        // live opportunity again, not a closed record.
        reopenClosedStatus: true,
      },
    });
    await settleIntakeEvent({
      eventId: recorded.eventId,
      status: "processed",
      leadId,
    });
  } catch (err) {
    await settleIntakeEvent({
      eventId: recorded.eventId,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
