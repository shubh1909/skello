// Coerce a phone number to E.164 for outbound dialing and WhatsApp.
//
// Providers reject numbers without a country code — Bolna returns "Provided
// recipient_phone_number is not valid. Please check and make sure country code
// is added", KwikEngage returns "invalid WhatsApp number (…). Please provide a
// valid phone number with country code". Shopify checkout phones frequently
// arrive as bare local numbers, so we supply the country code when we can.
//
// India is the default market; override with DEFAULT_DIAL_CODE (digits only).

export const DEFAULT_DIAL_CODE =
  (process.env.DEFAULT_DIAL_CODE ?? "91").replace(/\D/g, "") || "91";

// E.164 allows at most 15 digits including the country code, and no real
// dialable number is shorter than 8. Numbers outside this are not "probably
// fine" — they are junk that costs a provider call to discover.
const E164_MIN_DIGITS = 8;
const E164_MAX_DIGITS = 15;

// The national subscriber length in the default market. Used only to decide
// whether a bare local number needs the country code prepended.
const DEFAULT_NATIONAL_LENGTH = 10;

// The shortest subscriber part we'll believe sits behind a country code. Used
// to decide whether a number that *starts with* a dial code already carries it
// or merely begins with the same digits.
const MIN_SUBSCRIBER_DIGITS = 7;

/** How a number was rendered — useful for logs and for explaining a dial. */
export type E164Source =
  /** The caller wrote a full `+<cc>…` number; we validated and passed it on. */
  | "explicit"
  /** Already carried the default market's dial code. */
  | "default_present"
  /** A bare national number; the default market's dial code was prepended. */
  | "default_market"
  /** Rendered with the country hint the caller supplied. */
  | "hint"
  /** Too long to be national, so it must already carry someone's country code. */
  | "assumed_international";

export type E164Failure =
  | "empty"
  /** Digits present but outside E.164's 8–15 bound once assembled. */
  | "out_of_range"
  /** A short national number from a market nobody named. See below. */
  | "unknown_market";

export interface E164Resolution {
  e164: string | null;
  source: E164Source | null;
  reason: "ok" | E164Failure;
  /** The supplied country hint, normalised to digits, or null. */
  hint: string | null;
  /**
   * True when a country hint was supplied, disagreed with the default market,
   * and **lost**. The number still dialled — as a default-market number — so
   * this is not an error; it is the one case where we knowingly ignored data
   * the payload gave us, and it is worth showing an operator.
   */
  hintOverridden: boolean;
}

/**
 * Best-effort E.164, or `null` when we genuinely cannot tell.
 *
 * ## Why this returns null instead of guessing
 *
 * An older version prepended the country code only when the trunk-stripped
 * number was **exactly 10 digits**, and otherwise emitted `+<digits>` unchanged.
 * That silently mangled every market with a 9-digit national number:
 *
 * ```
 * 0563836325  → strip 0 → 563836325 (9)  → +563836325      ✗ a UAE mobile, now junk
 * 09876543210 → strip 0 → 9876543210 (10) → +919876543210  ✓
 * ```
 *
 * It was found in production: a send failed with `invalid WhatsApp number
 * (193593025)`, and the cost is not just the failed send — it burns a
 * `whatsapp_attempt` against a cap that **defaults to 1**, so the cart gets one
 * shot, spends it on a number that could never work, and is never messaged
 * again. Returning `null` moves that decision to the caller, which can skip
 * without spending an attempt.
 *
 * ## Why the default market beats the country hint
 *
 * The fix above introduced a worse bug. Once a Shopify address's `country_code`
 * was threaded in as `dialCode`, it was treated as authoritative — so a cart
 * whose address said (say) `AE` while the shopper had typed a perfectly ordinary
 * Indian mobile produced `+971…`, and the voice provider answered
 * `Only +1 and +91 numbers are allowed`. Nothing was dialled and nothing was
 * messaged. A hint that arrives attached to an address the shopper may never
 * have completed is weaker evidence than the shape of the number itself.
 *
 * So the hint is a **fallback, not an authority**: it is consulted only when the
 * default market cannot explain the number. Concretely, a trunk-stripped
 * 10-digit number always dials as `+91…`; the 9-digit UAE number, which India
 * cannot explain, still gets rescued by the hint.
 *
 * The trade-off is real and deliberate: a genuine foreign shopper whose national
 * number happens to be 10 digits will be dialled as Indian. `hintOverridden`
 * records exactly that, so those carts can be flagged rather than silently
 * mis-dialled. This restores the behaviour every existing row was scheduled
 * under while keeping the non-default-market rescue.
 *
 * ## Why not a full phone library
 *
 * `libphonenumber-js` would be the right call if this needed to be correct for
 * every market — length heuristics fundamentally cannot distinguish a UAE
 * number from a truncated Indian one, nor a 10-digit UK mobile from a 10-digit
 * Indian one. This keeps the heuristic but makes it **honest**: it produces a
 * number only for the cases it can actually reason about, refuses the rest, and
 * reports when it had to choose. Swapping in the library later is a change to
 * this one function.
 *
 * @param raw the number as stored — any punctuation, optional leading `+`
 * @param dialCode digits-only country code for the number's market when known
 *   (e.g. `"971"`). Consulted only when the default market can't explain the
 *   number.
 */
export function resolveE164(
  raw: string | null | undefined,
  dialCode?: string | null,
): E164Resolution {
  const hint = normaliseDialCode(dialCode);
  const miss = (reason: E164Failure): E164Resolution => ({
    e164: null,
    source: null,
    reason,
    hint,
    hintOverridden: false,
  });
  const hit = (
    digits: string,
    source: E164Source,
    hintOverridden = false,
  ): E164Resolution =>
    withinE164(digits)
      ? { e164: `+${digits}`, source, reason: "ok", hint, hintOverridden }
      : miss("out_of_range");

  if (!raw) return miss("empty");

  const hadPlus = raw.trim().startsWith("+");
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length === 0) return miss("empty");

  // A leading zero is never a country code — E.164 assigns none beginning with
  // one — so `+07348061482` is a national number somebody typed a plus in front
  // of, not an international one. Honouring the plus there is how a literal
  // `+0…` reached the provider and came back rejected. Fall through and treat
  // it as national instead.
  if (hadPlus && !digits.startsWith("0")) {
    return hit(digits, "explicit");
  }

  // Drop the national trunk prefix.
  const national = digits.replace(/^0+/, "");
  if (national.length === 0) return miss("empty");

  // Already carries the default market's code, at a plausible total length.
  if (
    national.startsWith(DEFAULT_DIAL_CODE) &&
    national.length === DEFAULT_DIAL_CODE.length + DEFAULT_NATIONAL_LENGTH
  ) {
    return hit(national, "default_present");
  }

  // A bare national number for the default market. This is checked BEFORE the
  // hint on purpose — see "Why the default market beats the country hint".
  if (national.length === DEFAULT_NATIONAL_LENGTH) {
    return hit(
      `${DEFAULT_DIAL_CODE}${national}`,
      "default_market",
      hint !== null && hint !== DEFAULT_DIAL_CODE,
    );
  }

  // The hint's market — the only thing that can render a national number whose
  // length the default market cannot account for.
  if (hint) {
    const alreadyPrefixed =
      national.startsWith(hint) &&
      national.length >= hint.length + MIN_SUBSCRIBER_DIGITS;
    return hit(alreadyPrefixed ? national : `${hint}${national}`, "hint");
  }

  // Long enough that it must already include *some* country code. We can't
  // verify which, but prepending ours would certainly be wrong.
  if (national.length > DEFAULT_NATIONAL_LENGTH) {
    return hit(national, "assumed_international");
  }

  // Shorter than a national number, no country code, and no market told to us:
  // this is the UAE case. Inventing a country here is what produced
  // `+563836325`. Refuse, and let the caller skip with a reason instead of
  // burning an attempt.
  return miss("unknown_market");
}

/** Best-effort E.164, or `null`. Thin wrapper over {@link resolveE164}. */
export function coerceToE164(
  raw: string | null | undefined,
  dialCode?: string | null,
): string | null {
  return resolveE164(raw, dialCode).e164;
}

/**
 * A country calling code, or null if it isn't one.
 *
 * E.164 assigns codes of one to three digits, none starting with zero. Anything
 * else is a field we've misread — and a bogus "0" would prepend a literal zero,
 * producing the `+0…` the provider rejects.
 */
function normaliseDialCode(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 0 || digits.length > 3) return null;
  if (digits.startsWith("0")) return null;
  return digits;
}

function withinE164(digits: string): boolean {
  return (
    digits.length >= E164_MIN_DIGITS &&
    digits.length <= E164_MAX_DIGITS &&
    !digits.startsWith("0")
  );
}

/** True when `coerceToE164` can render this number. */
export function isDialable(
  raw: string | null | undefined,
  dialCode?: string | null,
): boolean {
  return coerceToE164(raw, dialCode) !== null;
}
