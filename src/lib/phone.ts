// Coerce a phone number to E.164 for outbound dialing. Telephony providers
// (Bolna) reject numbers without a country code — e.g. a bare 10-digit local
// number returns "Provided recipient_phone_number is not valid. Please check
// and make sure country code is added." Shopify checkout phones frequently
// arrive that way, so we default the country code when one is missing.
//
// India is the default market; override with DEFAULT_DIAL_CODE (digits only).
// Anything already carrying a country code — a leading "+" or a longer digit
// string — is passed through unchanged, so international numbers aren't touched.
const DEFAULT_DIAL_CODE =
  (process.env.DEFAULT_DIAL_CODE ?? "91").replace(/\D/g, "") || "91";

export function coerceToE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const hadPlus = raw.trim().startsWith("+");
  let digits = raw.replace(/[^0-9]/g, "");
  if (digits.length === 0) return null;

  if (!hadPlus) {
    // Local formats: drop a national trunk prefix (leading 0), then prepend the
    // country code only when the remainder is a bare 10-digit subscriber number.
    // A longer string is assumed to already include a country code.
    if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");
    if (digits.length === 10) digits = `${DEFAULT_DIAL_CODE}${digits}`;
  }

  return `+${digits}`;
}
