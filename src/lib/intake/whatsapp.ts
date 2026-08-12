import { createHmac, timingSafeEqual } from "node:crypto";

import type { IngestSnapshot, NormalisedLead } from "@/lib/leads/ingest";

/**
 * WhatsApp Cloud API — inbound message parsing, for Click-to-WhatsApp lead capture.
 *
 * Direct to Meta, not through a BSP: the `referral` object that carries the ad
 * attribution does not reliably survive a provider's relay, and it is the entire
 * reason this integration exists.
 *
 * Pure apart from the HMAC — no DB, no Supabase. The route does the I/O.
 */

/** The ad a Click-to-WhatsApp conversation started from. */
export interface WhatsAppReferral {
  /** The ad or post id. */
  source_id: string | null;
  source_url: string | null;
  /** "ad" | "post" — Meta's own vocabulary. */
  source_type: string | null;
  headline: string | null;
  body: string | null;
  media_type: string | null;
  /**
   * Meta's click id for the ad tap.
   *
   * Present ONLY on the first message of a conversation, and only when Ads
   * Attribution is enabled on the WABA. Required later by the Conversions API to
   * attribute a sale back to ad spend — unrecoverable if we don't capture it
   * now, which is why it is stored even though nothing reads it yet.
   */
  ctwa_clid: string | null;
}

export interface WhatsAppInboundMessage {
  /** Meta's message id (`wamid.…`). The idempotency key — Meta redelivers. */
  wamid: string;
  /** Sender's WhatsApp number, digits only, country code included. */
  from: string;
  /** Unix seconds, as Meta sends it. */
  timestamp: string | null;
  /** "text" | "image" | "location" | … A CTWA first message need not be text. */
  type: string;
  /** Body text when the message has any. */
  text: string | null;
  /** The sender's WhatsApp display name. User-chosen — treat with suspicion. */
  profileName: string | null;
  referral: WhatsAppReferral | null;
}

export interface WhatsAppWebhookEvent {
  /** The business number that RECEIVED the message. Resolves nothing by itself —
   *  tenancy comes from the URL token — but it is checked against the source. */
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  messages: WhatsAppInboundMessage[];
}

function str(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Verify Meta's `X-Hub-Signature-256`.
 *
 * HMAC-SHA256 of the RAW body, hex, prefixed `sha256=`. Must run on the exact
 * bytes received — a parsed-and-re-serialised body will not match, because key
 * order and whitespace are not preserved.
 *
 * Each client runs their own Meta app, so the secret differs per org: the tenant
 * has to be resolved from the URL token BEFORE this can be called. That is the
 * same resolve-then-verify order the Shopify route uses.
 */
export function verifyMetaSignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header) return false;
  const prefix = "sha256=";
  if (!header.startsWith(prefix)) return false;
  const sent = Buffer.from(header.slice(prefix.length), "hex");
  const digest = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  // A malformed hex string decodes to a short buffer; length-check before
  // timingSafeEqual, which throws on a mismatch rather than returning false.
  return digest.length === sent.length && timingSafeEqual(digest, sent);
}

/**
 * Pull the inbound messages out of a Cloud API webhook body.
 *
 * Shape: `entry[].changes[].value.{metadata,contacts,messages,statuses}`.
 * Deliberately tolerant — Meta adds fields, and other subscription types
 * (`statuses`, template updates, account alerts) arrive on the same endpoint.
 * Those yield an empty `messages` array rather than an error.
 *
 * `contacts` is keyed by `wa_id` and matched against each message's `from`
 * rather than assuming `contacts[0]`: one delivery can carry messages from more
 * than one sender, and pairing them positionally would attach the wrong name.
 */
export function parseWhatsAppWebhook(body: unknown): WhatsAppWebhookEvent {
  const empty: WhatsAppWebhookEvent = {
    phoneNumberId: null,
    displayPhoneNumber: null,
    messages: [],
  };

  const root = obj(body);
  if (!root) return empty;

  const messages: WhatsAppInboundMessage[] = [];
  let phoneNumberId: string | null = null;
  let displayPhoneNumber: string | null = null;

  for (const entryRaw of arr(root.entry)) {
    const entry = obj(entryRaw);
    if (!entry) continue;

    for (const changeRaw of arr(entry.changes)) {
      const change = obj(changeRaw);
      const value = obj(change?.value);
      if (!value) continue;

      const metadata = obj(value.metadata);
      phoneNumberId ??= str(metadata?.phone_number_id);
      displayPhoneNumber ??= str(metadata?.display_phone_number);

      const namesByWaId = new Map<string, string>();
      for (const contactRaw of arr(value.contacts)) {
        const contact = obj(contactRaw);
        const waId = str(contact?.wa_id);
        const name = str(obj(contact?.profile)?.name);
        if (waId && name) namesByWaId.set(waId, name);
      }

      for (const messageRaw of arr(value.messages)) {
        const message = obj(messageRaw);
        if (!message) continue;
        const wamid = str(message.id);
        const from = str(message.from);
        if (!wamid || !from) continue;

        const type = str(message.type) ?? "unknown";
        messages.push({
          wamid,
          from,
          timestamp: str(message.timestamp),
          type,
          text: readBody(message, type),
          profileName: namesByWaId.get(from) ?? null,
          referral: readReferral(message.referral),
        });
      }
    }
  }

  return { phoneNumberId, displayPhoneNumber, messages };
}

/**
 * The human-readable content, whatever the message type.
 *
 * A CTWA conversation does not have to open with text — a caption on an image,
 * a button label, or nothing at all are all normal. Anything with no text yields
 * null and the lead is still created; the type is recorded separately.
 */
function readBody(message: Record<string, unknown>, type: string): string | null {
  switch (type) {
    case "text":
      return str(obj(message.text)?.body);
    case "button":
      return str(obj(message.button)?.text);
    case "interactive": {
      const interactive = obj(message.interactive);
      return (
        str(obj(interactive?.button_reply)?.title) ??
        str(obj(interactive?.list_reply)?.title)
      );
    }
    case "image":
    case "video":
    case "document":
      return str(obj(message[type])?.caption);
    default:
      return null;
  }
}

function readReferral(raw: unknown): WhatsAppReferral | null {
  const r = obj(raw);
  if (!r) return null;
  const referral: WhatsAppReferral = {
    source_id: str(r.source_id),
    source_url: str(r.source_url),
    source_type: str(r.source_type),
    headline: str(r.headline),
    body: str(r.body),
    media_type: str(r.media_type),
    ctwa_clid: str(r.ctwa_clid),
  };
  // An object with nothing usable in it is not a referral. Guarding here means
  // "did this come from an ad?" downstream is a plain null check.
  return Object.values(referral).some((v) => v !== null) ? referral : null;
}

/**
 * Turn one inbound message into the channel-neutral lead shape.
 *
 * The ad context OVERWRITES whatever was there before: `custom_data.whatsapp`
 * always describes the most recent ad this person responded to, which is the one
 * the salesperson should open with. The full history stays in the delivery log.
 */
export function normaliseWhatsAppLead(
  message: WhatsAppInboundMessage,
): NormalisedLead {
  const whatsapp: Record<string, unknown> = {
    first_message: message.text,
    message_type: message.type,
  };

  if (message.referral) {
    const r = message.referral;
    if (r.source_id) whatsapp.ad_id = r.source_id;
    if (r.headline) whatsapp.ad_headline = r.headline;
    if (r.body) whatsapp.ad_body = r.body;
    if (r.source_url) whatsapp.ad_source_url = r.source_url;
    if (r.source_type) whatsapp.ad_source_type = r.source_type;
    if (r.ctwa_clid) whatsapp.ctwa_clid = r.ctwa_clid;
  }

  // Drop null values rather than writing them: a null in the JSONB would
  // register a field in the catalog that never has a value, and show as a blank
  // row on every lead sheet configured to display it.
  for (const [key, value] of Object.entries(whatsapp)) {
    if (value === null || value === undefined) delete whatsapp[key];
  }

  const snapshot: IngestSnapshot = {
    lead_data: {},
    custom_data: { whatsapp },
  };

  return {
    // `from` is digits-only with the country code — exactly what
    // leads.phone_normalized generates, so dedupe against a call-sourced lead
    // for the same person works without further massaging.
    phone: message.from,
    name: message.profileName,
    city: null,
    pincode: null,
    source: "whatsapp",
    snapshot,
  };
}
