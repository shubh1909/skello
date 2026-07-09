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

  const errorMessage =
    pick(src, ["error", "error_message", "reason"]) ??
    pick(b, ["error", "error_message"]);
  return { providerMessageId: id, status, errorMessage };
}
