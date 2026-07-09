// Deep-redacts PII and secrets from Sentry payloads before anything leaves the
// process. Isomorphic on purpose — no `server-only`, no Node APIs — so the
// server, edge, and client runtimes all share exactly one redaction policy.
//
// Two layers, because either alone leaks:
//   1. Key-based — any object key whose NAME looks sensitive is blanked, so we
//      never depend on recognising the value (e.g. `api_token`, `to_number`).
//   2. Value-based — every string is scanned for phone numbers, emails, bearer
//      tokens, and URL query strings (the Shopify recovery `?key=` is a LIVE
//      checkout token), so a value nested under an innocuous key still gets hit.
//
// The webhook incident that motivated this dumped a raw Bolna payload — phone,
// customer name, recording URL, and a checkout `key` — into the error log. This
// guarantees none of that reaches Sentry regardless of where it sits in the event.

const REDACTED = "[redacted]";
const MAX_STRING = 2_000;
const MAX_DEPTH = 12;

// Key names we blank outright. Matched case-insensitively as a substring, with
// optional separators so `toNumber`, `to_number`, and `to-number` all match.
const SENSITIVE_KEY =
  /authorization|cookie|token|secret|passw(or)?d|api[_-]?key|access[_-]?key|credential|signature|session|customer[_-]?name|full[_-]?name|first[_-]?name|last[_-]?name|contact[_-]?name|shopper|e[_-]?mail|phone|mobile|to_?number|from_?number|user_?number|agent_?number|recipient|recovery_?url|recording_?url|checkout_?url|ip_?address|pincode|postal|address/i;

// Value patterns. Order matters: strip URL query strings before phone/email so
// tokens inside a query don't get partially matched by the narrower patterns.
const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/gi;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// E.164 (must start with +) — avoids matching ISO dates/ids that lack a +.
const E164_RE = /\+\d{6,15}\b/g;
// Bare Indian mobile: 10 digits starting 6-9 (won't match dates, which start 1-2).
const IN_PHONE_RE = /\b[6-9]\d{9}\b/g;

function scrubString(input: string): string {
  let out =
    input.length > MAX_STRING
      ? `${input.slice(0, MAX_STRING)}…[truncated]`
      : input;
  out = out.replace(URL_RE, (url) => {
    const q = url.indexOf("?");
    return q === -1 ? url : `${url.slice(0, q)}?${REDACTED}`;
  });
  out = out.replace(BEARER_RE, `Bearer ${REDACTED}`);
  out = out.replace(EMAIL_RE, "[email]");
  out = out.replace(E164_RE, "[phone]");
  out = out.replace(IN_PHONE_RE, "[phone]");
  return out;
}

function scrub(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === "string") return scrubString(value);
  if (!value || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = scrub(value[i], seen, depth + 1);
    }
    return value;
  }

  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    obj[key] = SENSITIVE_KEY.test(key)
      ? REDACTED
      : scrub(obj[key], seen, depth + 1);
  }
  return value;
}

// Mutates and returns the same event (Sentry's documented `beforeSend` contract).
// Also drops `user`/`server_name` wholesale as defence-in-depth beyond
// `sendDefaultPii: false` — we never want an IP, email, or hostname attached.
export function scrubSentryEvent<T>(event: T): T {
  if (event && typeof event === "object") {
    const e = event as Record<string, unknown>;
    delete e.user;
    delete e.server_name;
  }
  return scrub(event, new WeakSet(), 0) as T;
}
