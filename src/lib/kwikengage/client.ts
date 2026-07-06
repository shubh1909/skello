import "server-only";

import { coerceToE164 } from "@/lib/phone";
import {
  WhatsAppSendError,
  type WhatsAppProvider,
  type WhatsAppSendInput,
  type WhatsAppSendResult,
} from "@/lib/whatsapp/provider";

// KwikEngage (GoKwik / Kwikchat) WhatsApp BSP adapter. Under the hood this is
// Tellephant (api.tellephant.com). Internal only — product UI says "WhatsApp",
// never the vendor name.
const DEFAULT_BASE = "https://api.tellephant.com";

function baseUrl(override?: string | null): string {
  const url = override?.trim() || process.env.KWIKENGAGE_API_BASE_URL?.trim();
  return url && url.length > 0 ? url.replace(/\/+$/, "") : DEFAULT_BASE;
}

// Positional order of the approved Meta template's variables ({{1}}, {{2}}, …).
// Keys map to buildRecoveryVariables output. If your approved template's
// parameter order/count differs, change ONLY this array (or promote it to
// per-org config) — nothing else in the pipeline depends on the order.
export const TEMPLATE_VARIABLE_ORDER = [
  "customer_name",
  "top_product",
  "cart_total",
  "discounted_cart_total",
  "discount_code",
  "recovery_url",
] as const;

// ===========================================================================
// PROVIDER PAYLOAD SEAM — Tellephant (KwikEngage/Kwikchat) send-message API.
// POST {base}/v1/send-message. Auth is the `apikey` body field; the partner
// (MoEngage) path also accepts an `X-api-key` header, so we send both. Body
// variables map into Meta-style template `components`. This is the ONLY place
// the real request shape lives — the rest of the pipeline is provider-agnostic.
// ===========================================================================
const TEMPLATE_LANGUAGE = "en";

function buildTemplateRequest(
  input: WhatsAppSendInput,
  recipient: string,
): { url: string; headers: Record<string, string>; body: string } {
  // Tellephant wants `to` as bare digits (no leading +).
  const toDigits = recipient.replace(/\D/g, "");
  const parameters = TEMPLATE_VARIABLE_ORDER.map((k) => ({
    type: "text",
    text: input.variables[k] ?? "",
  }));

  return {
    url: `${baseUrl(input.baseUrl)}/v1/send-message`,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-api-key": input.apiToken,
    },
    body: JSON.stringify({
      apikey: input.apiToken,
      to: Number(toDigits),
      channels: ["whatsapp"],
      whatsapp: {
        contentType: "template",
        template: {
          templateId: input.templateName,
          language: TEMPLATE_LANGUAGE,
          components: [{ type: "body", parameters }],
        },
      },
    }),
  };
}

// Accept the message id under whichever field the provider returns it, incl.
// Meta cloud-style `{ messages: [{ id }] }` and `{ data: { id } }`.
const ID_KEYS = [
  "message_id",
  "messageId",
  "mid",
  "msgId",
  "id",
] as const;

function extractMessageId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  for (const key of ID_KEYS) {
    const v = b[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  const messages = b.messages;
  if (Array.isArray(messages) && messages[0] && typeof messages[0] === "object") {
    const first = messages[0] as Record<string, unknown>;
    if (typeof first.id === "string" && first.id.trim()) return first.id;
  }
  const data = b.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const key of ID_KEYS) {
      const v = d[key];
      if (typeof v === "string" && v.trim()) return v;
    }
  }
  return null;
}

export async function sendWhatsAppTemplate(
  input: WhatsAppSendInput,
): Promise<WhatsAppSendResult> {
  const recipient = coerceToE164(input.toPhone);
  if (!recipient) {
    throw new WhatsAppSendError(
      400,
      "Recipient phone is empty or contains no digits",
    );
  }

  const req = buildTemplateRequest(input, recipient);

  // Lightweight trace — no raw phone numbers / tokens in prod logs.
  console.log("[kwikengage] POST template", {
    template: input.templateName,
    recipientPrefixed: recipient.startsWith("+"),
    variables: TEMPLATE_VARIABLE_ORDER.length,
  });

  const response = await fetch(req.url, {
    method: "POST",
    headers: req.headers,
    body: req.body,
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new WhatsAppSendError(
      response.status,
      text || `WhatsApp provider returned ${response.status}`,
    );
  }

  const body = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  const id = extractMessageId(body);
  if (!id) {
    throw new WhatsAppSendError(502, "WhatsApp provider response missing message id");
  }
  const status =
    body && typeof body.status === "string" ? body.status : "sent";
  return { providerMessageId: id, status };
}

export const kwikengageProvider: WhatsAppProvider = {
  name: "kwikengage",
  sendTemplate: sendWhatsAppTemplate,
};
