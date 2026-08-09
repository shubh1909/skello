// Coerce a phone number to E.164 for outbound dialing and WhatsApp.
//
// Providers reject numbers without a country code — Bolna returns "Provided
// recipient_phone_number is not valid. Please check and make sure country code
// is added", KwikEngage returns "invalid WhatsApp number (…). Please provide a
// valid phone number with country code". Shopify checkout phones frequently
// arrive as bare local numbers, so we supply the country code when we can.
//
// India is the default market; override with DEFAULT_DIAL_CODE (digits only).

const DEFAULT_DIAL_CODE =
  (process.env.DEFAULT_DIAL_CODE ?? "91").replace(/\D/g, "") || "91";

// E.164 allows at most 15 digits including the country code, and no real
// dialable number is shorter than 8. Numbers outside this are not "probably
// fine" — they are junk that costs a provider call to discover.
const E164_MIN_DIGITS = 8;
const E164_MAX_DIGITS = 15;

// The national subscriber length in the default market. Used only to decide
// whether a bare local number needs the country code prepended.
const DEFAULT_NATIONAL_LENGTH = 10;

/**
 * Best-effort E.164, or `null` when we genuinely cannot tell.
 *
 * ## Why this returns null instead of guessing
 *
 * The previous version prepended the country code only when the trunk-stripped
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
 * again.
 *
 * Returning `null` moves that decision to the caller, which can skip without
 * spending an attempt. A number we can't render is a data problem to surface,
 * not a string to hand to a provider and hope.
 *
 * ## Why not a full phone library
 *
 * `libphonenumber-js` would be the right call if this needed to be correct for
 * every market — length heuristics fundamentally cannot distinguish a UAE
 * number from a truncated Indian one. This keeps the heuristic but makes it
 * **honest**: it produces a number only for the cases it can actually reason
 * about, and refuses the rest. Swapping in the library later is a change to
 * this one function.
 *
 * @param raw the number as stored — any punctuation, optional leading `+`
 * @param dialCode digits-only country code for the number's market when known
 *   (e.g. `"971"`). Overrides DEFAULT_DIAL_CODE. Pass it whenever the source
 *   carries a country — a Shopify address, a store's locale — because it is the
 *   only thing that makes a non-default market reliable.
 */
export function coerceToE164(
  raw: string | null | undefined,
  dialCode?: string | null,
): string | null {
  if (!raw) return null;

  const hadPlus = raw.trim().startsWith("+");
  let digits = raw.replace(/[^0-9]/g, "");
  if (digits.length === 0) return null;

  const supplied = (dialCode ?? "").replace(/\D/g, "");
  const country = supplied || DEFAULT_DIAL_CODE;

  if (hadPlus) {
    // Already international — the caller told us so. Validate only.
    return withinE164(digits) ? `+${digits}` : null;
  }

  // Drop a national trunk prefix (leading 0) before anything else.
  if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  if (digits.length === 0) return null;

  // An explicitly supplied dial code names the market, which beats any length
  // heuristic — national lengths differ (India 10, UAE 9, …), so requiring a
  // specific one here would refuse the very numbers the caller passed a code to
  // rescue. Trust it: keep the code if already present, otherwise prepend it.
  if (supplied) {
    const full = digits.startsWith(supplied) ? digits : `${supplied}${digits}`;
    return withinE164(full) ? `+${full}` : null;
  }

  // No market given, so fall back to the default one — and only where the shape
  // actually matches it.

  // Already carries the default country code, at a plausible total length.
  if (
    digits.startsWith(country) &&
    digits.length === country.length + DEFAULT_NATIONAL_LENGTH
  ) {
    return withinE164(digits) ? `+${digits}` : null;
  }

  // A bare national number for the default market.
  if (digits.length === DEFAULT_NATIONAL_LENGTH) {
    const full = `${country}${digits}`;
    return withinE164(full) ? `+${full}` : null;
  }

  // Long enough that it must already include *some* country code. We can't
  // verify which, but prepending ours would certainly be wrong.
  if (digits.length > DEFAULT_NATIONAL_LENGTH) {
    return withinE164(digits) ? `+${digits}` : null;
  }

  // Shorter than a national number, no country code, and no market told to us:
  // this is the UAE case. Inventing a country here is what produced
  // `+563836325`. Refuse, and let the caller skip with a reason instead of
  // burning an attempt.
  return null;
}

function withinE164(digits: string): boolean {
  return digits.length >= E164_MIN_DIGITS && digits.length <= E164_MAX_DIGITS;
}

/** True when `coerceToE164` can render this number. */
export function isDialable(
  raw: string | null | undefined,
  dialCode?: string | null,
): boolean {
  return coerceToE164(raw, dialCode) !== null;
}
