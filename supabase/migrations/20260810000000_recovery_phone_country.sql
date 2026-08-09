-- Store the country the recovery phone came from.
--
-- Why: `coerceToE164` can only render a local-format number if it knows the
-- market. Without this, a 9-digit national number (UAE and every other market
-- whose subscriber part isn't 10 digits) either became junk — production saw
-- `+563836325` rejected as "invalid WhatsApp number" — or, after the parser was
-- made strict, was skipped outright. Neither reaches the customer.
--
-- Shopify sends `country_code` on the shipping/billing address of a
-- checkouts/* payload; `normalizeAbandonedCheckout` now extracts it alongside
-- the phone (from the SAME source, so the two can't be mismatched) and the
-- dispatchers pass it to the phone coercion.
--
-- Nullable and free-text on purpose:
--   * Nullable — historical rows have no country, and a NOT NULL default would
--     be inventing one. Null reads as "unknown market", which the dispatchers
--     treat as skip-with-a-reason rather than assume the default dial code.
--   * Text, not an enum — the value is whatever the payload carried. It is
--     normally ISO-3166-1 alpha-2 ("AE"), but a raw dial code ("971") is also
--     accepted by `dialCodeForCountry`. An enum would reject payload shapes we
--     don't control and drop the row.
--
-- Length-capped so a malformed payload can't write an essay into the column.
alter table public.shopify_recovery_attempts
  add column if not exists phone_country text
    check (phone_country is null or char_length(phone_country) between 1 and 8);

comment on column public.shopify_recovery_attempts.phone_country is
  'ISO-3166-1 alpha-2 (or a raw dial code) for the address the phone came from. Null = unknown market; the dispatchers skip rather than assume a default.';
