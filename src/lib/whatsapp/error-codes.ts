// Provider-agnostic classification of WhatsApp / Meta message failures.
//
// KwikEngage (and every Meta BSP) surfaces the underlying Meta Cloud API error
// code in the failure text — usually as "(#NNNNN) message". A raw "failed" is
// too blunt: a per-user marketing cap is nothing like a broken template. We map
// the code to a DISPOSITION that drives whether we retry, skip, or hard-fail —
// and a short snake_case reason we store on the recovery attempt.
//
// References: Meta WhatsApp Cloud API "Error codes" + "Messages" error tables.

export type WhatsAppErrorDisposition =
  // Meta suppressed delivery to protect the USER (per-recipient, time-based).
  // Not our fault, not a config problem — retrying now won't help; it clears as
  // the user's window resets. Show as "capped", never a red failure.
  | "capped"
  // The user explicitly stopped marketing messages. Permanent for marketing.
  | "opted_out"
  // The recipient can't receive this at all (not on WhatsApp, blocked us, bad
  // number, hasn't accepted ToS). Permanent — retrying is pointless.
  | "undeliverable"
  // Throughput / spam / pair rate limit on OUR number. Transient — a later retry
  // can succeed.
  | "rate_limited"
  // Template / parameter / policy problem. Won't succeed until the template or
  // payload is fixed — retrying wastes attempts.
  | "config"
  // Provider/Meta hiccup ("something went wrong", service unavailable). Retry.
  | "transient"
  // Unrecognised — treat like a normal failure (retry under the cap).
  | "unknown";

export interface WhatsAppErrorInfo {
  disposition: WhatsAppErrorDisposition;
  code: number | null;
  reason: string; // snake_case; stored in whatsapp_skip_reason / whatsapp_error
}

// Meta code → (disposition, reason). Only codes we can act on distinctly are
// listed; anything else falls through to keyword matching, then "unknown".
const CODE_MAP: Record<number, { disposition: WhatsAppErrorDisposition; reason: string }> = {
  // --- Per-user caps / opt-out (soft, don't retry, not a failure) ---
  131049: { disposition: "capped", reason: "marketing_cap" }, // "healthy ecosystem engagement" / marketing frequency cap
  130472: { disposition: "capped", reason: "per_user_cap" }, // user's number is part of an experiment
  131050: { disposition: "opted_out", reason: "opted_out" }, // user stopped marketing messages

  // --- Recipient undeliverable (permanent) ---
  131026: { disposition: "undeliverable", reason: "cannot_receive" }, // not on WhatsApp / can't receive / ToS
  131021: { disposition: "undeliverable", reason: "invalid_recipient" }, // recipient invalid / same as sender
  131047: { disposition: "undeliverable", reason: "cannot_receive" }, // re-engagement window (non-template)

  // --- Rate limits (transient, retry later) ---
  131048: { disposition: "rate_limited", reason: "spam_rate_limit" }, // number sending restrictions
  131056: { disposition: "rate_limited", reason: "pair_rate_limit" }, // too many to same recipient
  130429: { disposition: "rate_limited", reason: "rate_limited" }, // cloud API throughput
  80007: { disposition: "rate_limited", reason: "rate_limited" },
  368: { disposition: "rate_limited", reason: "temporarily_blocked" }, // temp policy block

  // --- Config / template / policy (fix required, don't retry) ---
  131008: { disposition: "config", reason: "missing_param" },
  131009: { disposition: "config", reason: "invalid_param" },
  132000: { disposition: "config", reason: "param_count_mismatch" },
  132001: { disposition: "config", reason: "template_not_found" }, // not approved / wrong language
  132005: { disposition: "config", reason: "text_too_long" },
  132007: { disposition: "config", reason: "policy_violation" },
  132012: { disposition: "config", reason: "param_format" },
  132015: { disposition: "config", reason: "template_paused" }, // quality pause
  132016: { disposition: "config", reason: "template_disabled" },
  100: { disposition: "config", reason: "invalid_request" },

  // --- Transient server errors (retry) ---
  131000: { disposition: "transient", reason: "provider_error" },
  131016: { disposition: "transient", reason: "service_unavailable" },
  131031: { disposition: "config", reason: "account_restricted" }, // account locked — needs attention
};

// Keyword fallback for provider text without a parseable (#code).
const KEYWORD_RULES: Array<{ re: RegExp; disposition: WhatsAppErrorDisposition; reason: string }> = [
  { re: /marketing message limit|healthy ecosystem|frequency/i, disposition: "capped", reason: "marketing_cap" },
  { re: /experiment/i, disposition: "capped", reason: "per_user_cap" },
  { re: /stop(ped)? receiving|opt(ed)?[ -]?out|unsubscrib/i, disposition: "opted_out", reason: "opted_out" },
  { re: /not.*whatsapp|undeliverable|cannot receive|invalid.*(recipient|number)/i, disposition: "undeliverable", reason: "cannot_receive" },
  { re: /rate limit|too many messages|spam/i, disposition: "rate_limited", reason: "rate_limited" },
  { re: /template|parameter|param /i, disposition: "config", reason: "template_error" },
];

function parseCode(raw: string): number | null {
  const m = /\(#(\d+)\)|\berror[_ ]?code["' :]+(\d+)/i.exec(raw);
  const digits = m?.[1] ?? m?.[2];
  return digits ? Number(digits) : null;
}

/**
 * Classify a failure into a disposition we can act on.
 *
 * `knownCode` is the code lifted straight off the provider payload (Meta's
 * `errors[].code`). Prefer it: the regex fallback only works when the provider
 * happens to inline "(#131049)" in prose, which Meta's webhook does NOT — it
 * sends the code as a number in a structured field. Text is the provider's to
 * reword at will; the code is stable.
 */
export function classifyWhatsAppError(
  raw: string | null | undefined,
  knownCode?: number | null,
): WhatsAppErrorInfo {
  const text = (raw ?? "").trim();

  if (knownCode != null && CODE_MAP[knownCode]) {
    return { ...CODE_MAP[knownCode], code: knownCode };
  }
  if (!text) {
    // A code we don't have mapped is still worth carrying — it's the only thing
    // that makes an unrecognised failure diagnosable after the fact.
    return knownCode != null
      ? { disposition: "unknown", code: knownCode, reason: "delivery_failed" }
      : { disposition: "unknown", code: null, reason: "unknown" };
  }

  const code = knownCode ?? parseCode(text);
  if (code !== null && CODE_MAP[code]) {
    return { ...CODE_MAP[code], code };
  }
  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(text)) {
      return { disposition: rule.disposition, code, reason: rule.reason };
    }
  }
  return { disposition: "unknown", code, reason: "delivery_failed" };
}

// Maps a disposition to the terminal `whatsapp_status` we should store when we
// are NOT going to retry. `null` means "this disposition is retryable — do not
// terminate here". Used by both the send-time catch and the delivery webhook.
export function terminalStatusFor(
  disposition: WhatsAppErrorDisposition,
): "skipped" | "failed" | null {
  switch (disposition) {
    case "capped":
    case "opted_out":
    case "undeliverable":
      return "skipped"; // soft — reached its limit / can't receive; not a failure
    case "config":
      return "failed"; // needs fixing; retrying the same payload won't help
    case "rate_limited":
    case "transient":
    case "unknown":
      return null; // retryable (subject to the attempt cap)
  }
}

// Human-friendly label for a stored whatsapp_skip_reason (for badges/tooltips).
export function whatsappReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  switch (reason) {
    case "marketing_cap":
    case "per_user_cap":
      return "Capped";
    case "opted_out":
      return "Opted out";
    case "cannot_receive":
    case "invalid_recipient":
      return "Undeliverable";
    default:
      return reason.replace(/_/g, " ");
  }
}
