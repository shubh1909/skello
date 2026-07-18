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

// Where the human-readable failure lives. KwikEngage uses `error_reason`; other
// BSPs / Meta's own webhook use `error`, `error_message`, or errors[].title.
const ERROR_TEXT_KEYS = [
  "error_reason",
  "error_message",
  "error",
  "reason",
] as const;

// "whatsapp::error::131049" → 131049 · "(#131049) Delivery restricted…" → 131049
// The code is what we actually act on, so dig it out of whatever wrapper the BSP
// puts around it rather than trusting one field to be clean.
function codeFromString(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const inlined = /\(#(\d+)\)/.exec(value);
  if (inlined) return Number(inlined[1]);
  const trailing = /(?:^|[^\d])(\d{2,6})\s*$/.exec(value.trim());
  return trailing ? Number(trailing[1]) : null;
}

// KwikEngage sends the SAME code three ways on one payload:
//   meta_error_code: "131049"                  ← clean, prefer this
//   error_code:      "whatsapp::error::131049" ← namespaced; asNumber() → NaN
//   error_reason:    "(#131049) Delivery restricted…"
// Reading only a numeric `error_code` (as we first did) yields null on all of it.
function codeFrom(src: Record<string, unknown>): number | null {
  const direct =
    asNumber(src.meta_error_code) ??
    asNumber(src.error_code) ??
    asNumber(src.code);
  if (direct !== null) return direct;
  return (
    codeFromString(src.error_code) ??
    codeFromString(src.code) ??
    codeFromString(src.meta_error_code) ??
    codeFromString(src.error_reason) ??
    codeFromString(src.error)
  );
}

// Normalise any provider's failure into { message, code }.
//
// Two shapes in the wild, and we must read both:
//   Meta (documented):  errors: [{ code, title, error_data: { details } }]
//   KwikEngage (real):  flat — error_reason / meta_error_code / error_code
//
// Returns the code separately so nothing downstream depends on parsing prose,
// and renders the text into the "(#code) …" form classifyWhatsAppError also
// understands, for the paths that only have text.
function errorFrom(
  src: Record<string, unknown>,
): { message: string | null; code: number | null } {
  const raw = src.errors ?? src.error;

  // --- Meta's documented array-of-objects shape ---
  const list = Array.isArray(raw) ? raw : null;
  const first =
    list && list[0] && typeof list[0] === "object"
      ? (list[0] as Record<string, unknown>)
      : !list && raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)
        : null;

  if (first) {
    const code = asNumber(first.code) ?? codeFrom(first);
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

  // --- KwikEngage's flat shape (and any other string-error provider) ---
  const message = pick(src, [...ERROR_TEXT_KEYS]);
  const code = codeFrom(src);
  // Don't double-prefix: error_reason already leads with "(#131049)".
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
