import "server-only";

import { coerceToE164 } from "@/lib/phone";
import {
  WhatsAppSendError,
  type WhatsAppProvider,
  type WhatsAppSendInput,
  type WhatsAppSendResult,
} from "@/lib/whatsapp/provider";

// KwikEngage (GoKwik) WhatsApp BSP adapter — their own API at
// api.kwikengage.ai. Internal only — product UI says "WhatsApp", never the
// vendor name.
const DEFAULT_BASE = "https://api.kwikengage.ai";

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
// PROVIDER PAYLOAD SEAM — KwikEngage send-message API (confirmed from docs).
//   POST {base}/send-message/v2
//   Header: Authorization: <api key>   (raw key, no "Bearer")
//   Body: { to, channel:"whatsapp", content:{ type:"template",
//           template:{ template_id, language, components:[{type:"body",
//           parameters:[{type:"text",text}]}] } } }
//   Response: { success, messageId }.
// The `template_id` is whatever the org configures as the template name (that's
// the value KwikEngage matches). `language` must match the approved template's
// language code. This is the ONE place the provider request shape lives.
// ===========================================================================
const TEMPLATE_LANGUAGE = "en";

function buildTemplateRequest(
  input: WhatsAppSendInput,
  recipient: string,
): { url: string; headers: Record<string, string>; body: string } {
  // KwikEngage `to` is a string; send the international number without the +.
  const to = recipient.replace(/^\+/, "");
  const parameters = TEMPLATE_VARIABLE_ORDER.map((k) => ({
    type: "text",
    text: input.variables[k] ?? "",
  }));

  return {
    url: `${baseUrl(input.baseUrl)}/send-message/v2`,
    headers: {
      "Content-Type": "application/json",
      Authorization: input.apiToken,
    },
    body: JSON.stringify({
      to,
      channel: "whatsapp",
      content: {
        type: "template",
        template: {
          template_id: input.templateName,
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

function idFromRecord(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  for (const key of ID_KEYS) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

// Wrapper keys KwikEngage / Meta-style BSPs nest the payload under. We check the
// envelope and each of these one level deep — but NOT a blind recursive scan,
// since a generic `id` could match an unrelated org/account id elsewhere.
const CONTAINER_KEYS = ["data", "result", "response", "payload"] as const;

function extractMessageId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  const top = idFromRecord(b);
  if (top) return top;

  const messages = b.messages;
  if (Array.isArray(messages) && messages[0]) {
    const fromMsg = idFromRecord(messages[0]);
    if (fromMsg) return fromMsg;
  }

  for (const key of CONTAINER_KEYS) {
    const nested = b[key];
    const fromNested = idFromRecord(nested);
    if (fromNested) return fromNested;
    // One more level — some responses are { data: { data: { messageId } } }.
    if (nested && typeof nested === "object") {
      const n = nested as Record<string, unknown>;
      for (const inner of CONTAINER_KEYS) {
        const deep = idFromRecord(n[inner]);
        if (deep) return deep;
      }
    }
  }
  return null;
}

// A 2xx can still be a soft failure ({ success:false, error }). Surface the
// provider's own message so the failure is actionable instead of "missing id".
function extractProviderError(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const succeeded =
    b.success === true || b.status === "success" || b.status === "sent";
  if (succeeded) return null;
  for (const key of ["error", "message", "error_message", "reason"] as const) {
    const v = b[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  if (b.success === false) return "WhatsApp provider rejected the send";
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
    // A 2xx with no id is either a soft failure (surface the provider's own
    // message) or an unrecognised response shape (log the raw body so the
    // extraction paths can be extended — no PII in a template-send response).
    const providerError = extractProviderError(body);
    if (providerError) {
      throw new WhatsAppSendError(502, providerError);
    }
    console.error("[kwikengage] 2xx response with no message id", {
      template: input.templateName,
      body,
    });
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
