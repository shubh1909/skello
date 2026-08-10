/**
 * ISO 3166-1 alpha-2 → E.164 country calling code.
 *
 * Exists so a Shopify address's `country_code` can be turned into the dial code
 * `coerceToE164` needs. Without it a local-format number from any non-default
 * market is unrenderable — see the 2026-08-09 ledger entry on `+563836325`.
 *
 * ## Two deliberate choices
 *
 * **An unknown country returns `null`, not a default.** Falling back to the
 * default market would take a Vietnamese number and make it look Indian — a
 * number that dials *someone*, just not the customer. Returning null keeps the
 * existing behaviour for anything unmapped: the cart is skipped with a reason,
 * which is recoverable. Guessing is not.
 *
 * **NANP countries all map to `1`.** Canada, the US and the Caribbean share the
 * code; the area code carries the country. That's correct for dialling, and it
 * is why this is a calling-code map rather than a country map.
 *
 * Codes are stable — the ITU changes them roughly never — so this is data, not
 * config. Add a row when a market comes up.
 */
const DIAL_CODE_BY_COUNTRY: Readonly<Record<string, string>> = {
  // --- South Asia ---------------------------------------------------------
  IN: "91",
  PK: "92",
  BD: "880",
  LK: "94",
  NP: "977",
  MV: "960",
  BT: "975",
  AF: "93",

  // --- Gulf / Middle East -------------------------------------------------
  AE: "971",
  SA: "966",
  QA: "974",
  KW: "965",
  BH: "973",
  OM: "968",
  JO: "962",
  LB: "961",
  IL: "972",
  IQ: "964",
  IR: "98",
  TR: "90",
  YE: "967",

  // --- South-East / East Asia ---------------------------------------------
  SG: "65",
  MY: "60",
  ID: "62",
  TH: "66",
  VN: "84",
  PH: "63",
  KH: "855",
  LA: "856",
  MM: "95",
  BN: "673",
  CN: "86",
  HK: "852",
  MO: "853",
  TW: "886",
  JP: "81",
  KR: "82",
  MN: "976",

  // --- Oceania ------------------------------------------------------------
  AU: "61",
  NZ: "64",
  FJ: "679",
  PG: "675",

  // --- Europe -------------------------------------------------------------
  GB: "44",
  IE: "353",
  FR: "33",
  DE: "49",
  IT: "39",
  ES: "34",
  PT: "351",
  NL: "31",
  BE: "32",
  LU: "352",
  CH: "41",
  AT: "43",
  DK: "45",
  SE: "46",
  NO: "47",
  FI: "358",
  IS: "354",
  PL: "48",
  CZ: "420",
  SK: "421",
  HU: "36",
  RO: "40",
  BG: "359",
  GR: "30",
  HR: "385",
  SI: "386",
  RS: "381",
  BA: "387",
  MK: "389",
  AL: "355",
  ME: "382",
  EE: "372",
  LV: "371",
  LT: "370",
  UA: "380",
  BY: "375",
  MD: "373",
  RU: "7",
  KZ: "7",
  GE: "995",
  AM: "374",
  AZ: "994",
  CY: "357",
  MT: "356",

  // --- Africa -------------------------------------------------------------
  ZA: "27",
  NG: "234",
  KE: "254",
  GH: "233",
  EG: "20",
  MA: "212",
  DZ: "213",
  TN: "216",
  LY: "218",
  ET: "251",
  TZ: "255",
  UG: "256",
  RW: "250",
  ZM: "260",
  ZW: "263",
  MZ: "258",
  AO: "244",
  BW: "267",
  NA: "264",
  SN: "221",
  CI: "225",
  CM: "237",
  MU: "230",

  // --- Americas -----------------------------------------------------------
  // NANP — one calling code, many countries. The area code disambiguates.
  US: "1",
  CA: "1",
  PR: "1",
  DO: "1",
  JM: "1",
  TT: "1",
  BS: "1",
  BB: "1",

  MX: "52",
  BR: "55",
  AR: "54",
  CL: "56",
  CO: "57",
  PE: "51",
  VE: "58",
  EC: "593",
  BO: "591",
  PY: "595",
  UY: "598",
  CR: "506",
  PA: "507",
  GT: "502",
  SV: "503",
  HN: "504",
  NI: "505",
  CU: "53",
};

/**
 * The E.164 calling code for an ISO-2 country, or `null` when unmapped.
 *
 * Tolerates the shapes a webhook actually sends: lowercase, padded, or a
 * `country` field that already contains a dial code (`"+971"`, `"971"`).
 */
export function dialCodeForCountry(
  country: string | null | undefined,
): string | null {
  if (!country) return null;
  const raw = country.trim();
  if (raw.length === 0) return null;

  // Already a dial code rather than a country code. Bounded to what E.164
  // actually assigns — one to three digits, never starting with zero. The
  // looser `\d{1,4}` this replaced would accept "0" as a country code, and
  // prepending that yields `+0…`, which every provider rejects.
  if (/^\+?[1-9]\d{0,2}$/.test(raw)) return raw.replace(/\D/g, "");

  const iso = raw.toUpperCase();
  if (iso.length !== 2) return null;
  return DIAL_CODE_BY_COUNTRY[iso] ?? null;
}
