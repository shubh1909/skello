import type { WhatsAppDeliveryStatus } from "@/lib/shopify/whatsapp-recovery";

// Normalise a KwikEngage delivery-status string to our canonical set. Unknown
// strings return null (the webhook acks and ignores them).
export function mapKwikEngageStatus(
  raw: string | null | undefined,
): WhatsAppDeliveryStatus | null {
  if (!raw) return null;
  switch (raw.trim().toLowerCase()) {
    case "sent":
    case "accepted":
    case "submitted":
      return "sent";
    case "delivered":
    case "delivery":
      return "delivered";
    case "read":
    case "seen":
      return "read";
    case "failed":
    case "undelivered":
    case "rejected":
    case "error":
      return "failed";
    default:
      return null;
  }
}

export interface ParsedDelivery {
  providerMessageId: string;
  status: WhatsAppDeliveryStatus;
  errorMessage: string | null;
  // Meta's numeric error code (e.g. 131049), pulled straight off the payload
  // rather than regexed back out of prose. Drives classifyWhatsAppError.
  errorCode: number | null;
}

function pick(
  obj: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// Meta reports a failure as an ARRAY OF OBJECTS, never a plain string:
//
//   "errors": [{ code: 131049, title: "…", error_data: { details: "…" } }]
//
// `pick` only accepts strings, and the key is `errors` (plural) — so a payload
// like this used to fall straight through, leaving errorMessage null. That
// silently discarded the code and left classifyWhatsAppError with nothing to
// classify, collapsing every Meta rejection into a generic "Delivery failed".
//
// We render it back into the "(#code) title: details" shape classifyWhatsAppError
// already parses, AND return the code separately so nothing depends on the text.
function errorFrom(
  src: Record<string, unknown>,
): { message: string | null; code: number | null } {
  const raw = src.errors ?? src.error;

  // The real Meta shape.
  const list = Array.isArray(raw) ? raw : null;
  const first =
    list && list[0] && typeof list[0] === "object"
      ? (list[0] as Record<string, unknown>)
      : !list && raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)
        : null;

  if (first) {
    const code = asNumber(first.code);
    const title = pick(first, ["title", "message", "error", "reason"]);
    const data = first.error_data;
    const details =
      data && typeof data === "object"
        ? pick(data as Record<string, unknown>, ["details", "detail"])
        : null;
    const body = [title, details].filter(Boolean).join(": ");
    if (code !== null) {
      return { message: body ? `(#${code}) ${body}` : `(#${code})`, code };
    }
    return { message: body || null, code: null };
  }

  // Fallbacks: a plain string error, or a sibling numeric code field.
  const message = pick(src, ["error", "error_message", "reason"]);
  const code =
    asNumber(src.error_code) ?? asNumber(src.code) ?? null;
  if (message && code !== null && !message.includes(`#${code}`)) {
    return { message: `(#${code}) ${message}`, code };
  }
  return { message, code };
}

// ===========================================================================
// PROVIDER WEBHOOK SEAM
// Pull { message id, status, error } from a KwikEngage delivery webhook. The
// exact payload shape is provider-specific — this is the ONE place to adjust
// field names to KwikEngage's docs. Handles common shapes: top-level, nested
// `data`, and Meta cloud-style `statuses[0]`.
// ===========================================================================
export function parseKwikEngageWebhook(body: unknown): ParsedDelivery | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  const container =
    b.data && typeof b.data === "object"
      ? (b.data as Record<string, unknown>)
      : b;

  let src = container;
  const statuses = container.statuses ?? b.statuses;
  if (
    Array.isArray(statuses) &&
    statuses[0] &&
    typeof statuses[0] === "object"
  ) {
    src = statuses[0] as Record<string, unknown>;
  }

  const id =
    pick(src, [
      "message_id_attr",
      "message_id",
      "messageId",
      "id",
      "provider_message_id",
    ]) ?? pick(b, ["message_id_attr", "message_id", "messageId", "id"]);
  const status = mapKwikEngageStatus(
    pick(src, ["status", "event", "state", "message_status"]) ??
      pick(b, ["status", "event"]),
  );
  if (!id || !status) return null;

  // Prefer the status-level error (Meta puts it inside statuses[]); fall back to
  // the envelope for providers that hoist it.
  const fromStatus = errorFrom(src);
  const error = fromStatus.message || fromStatus.code !== null
    ? fromStatus
    : errorFrom(b);

  return {
    providerMessageId: id,
    status,
    errorMessage: error.message,
    errorCode: error.code,
  };
}
