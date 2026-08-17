import { flattenPayload, leafOf, sanitiseKey } from "@/lib/intake/keys";
import type { IngestSnapshot, NormalisedLead } from "@/lib/leads/ingest";
import type { LeadSource } from "@/types/lead";

/**
 * Property-portal enquiries — 99acres today, Magicbricks and Housing later.
 *
 * Pure. No DB, no `server-only`: the route does the I/O.
 *
 * ⚠️ **There is no published schema for any of these.** 99acres posts each
 * enquiry to a URL its account manager registers, and the field names differ per
 * seller account — the closest thing to a documented shape is Anarock's
 * (`First_Name`, `Mobile`, `Project_Name`, `Property_Code`, `Price`, `Remarks`).
 * The content type is undocumented too.
 *
 * So this adapter is built to survive not knowing:
 *   - it accepts JSON, form-encoded bodies and query strings alike
 *   - it matches field names through an alias table, case- and separator-blind
 *   - anything it does not recognise is still kept, as a custom field
 *   - the admin can override any guess through `field_map`
 */

/** Where one payload field ends up. Anything else becomes a custom field. */
export type PortalTarget =
  | "phone"
  | "name"
  | "first_name"
  | "last_name"
  | "email"
  | "city"
  | "pincode"
  | "ignore";

const KNOWN_TARGETS = new Set<string>([
  "phone",
  "name",
  "first_name",
  "last_name",
  "email",
  "city",
  "pincode",
  "ignore",
]);

/**
 * Aliases, keyed by the normalised form of the incoming field name.
 *
 * Normalisation strips case and every separator, so `Mobile__c`, `mobile_no`,
 * `MOBILE NO.` and `mobileno` all collapse to `mobileno` and match once.
 *
 * Deliberately conservative: only fields whose meaning is unambiguous are
 * mapped onto lead columns. `price`/`budget` is NOT here — on a property portal
 * that could be the buyer's budget or the listing's asking price, and guessing
 * wrong writes a number a salesperson would act on. It lands as a custom field
 * instead, where it is labelled and harmless.
 */
const ALIASES: Record<string, PortalTarget> = {};
const alias = (target: PortalTarget, ...names: string[]) => {
  for (const n of names) ALIASES[normaliseName(n)] = target;
};

alias(
  "phone",
  "phone", "mobile", "mobile no", "mobileno", "mobile number", "mobilenumber",
  "phone no", "phoneno", "phone number", "contact", "contact no", "contactno",
  "contact number", "cell", "cellphone", "Mobile__c", "user_mobile", "usermobile",
  "lead_mobile", "buyer_mobile", "primary_phone",
);
alias(
  "name",
  "name", "full name", "fullname", "customer name", "customername",
  "lead name", "leadname", "user name", "username", "buyer name", "contact name",
  "sender name", "enquirer name", "Name__c",
);
alias("first_name", "first name", "firstname", "fname", "First_Name__c", "given name");
alias("last_name", "last name", "lastname", "lname", "Last_Name__c", "surname");
alias(
  "email",
  "email", "email id", "emailid", "email address", "emailaddress", "mail",
  "e mail", "Email__c", "user_email", "lead_email",
);
alias("city", "city", "town", "City__c", "user_city", "lead_city");
alias("pincode", "pincode", "pin code", "zip", "zipcode", "postal code", "postcode");

/**
 * Strip case and every separator so alias matching is not defeated by a portal
 * that renames `mobile_no` to `Mobile No.` between accounts.
 */
function normaliseName(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Decode a request body regardless of how the portal chose to send it.
 *
 * Three encodings are in the wild and none is documented for 99acres, so all
 * three are accepted and merged: query-string parameters (some portals use a
 * plain GET), form-encoded bodies, and JSON. Query params come first and lose
 * to the body on a key collision — the body is the payload, the query string is
 * usually just routing.
 */
export function decodePortalRequest(args: {
  contentType: string | null;
  rawBody: string;
  searchParams: URLSearchParams;
}): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const [key, value] of args.searchParams.entries()) {
    // Our own routing/auth params are not lead data.
    if (key === "api_key" || key === "token" || key === "secret") continue;
    const trimmed = value.trim();
    if (trimmed) fields[key] = trimmed;
  }

  const body = args.rawBody.trim();
  if (!body) return fields;

  const type = (args.contentType ?? "").toLowerCase();

  if (type.includes("application/json") || body.startsWith("{") || body.startsWith("[")) {
    try {
      Object.assign(fields, flattenPayload(JSON.parse(body)));
      return fields;
    } catch {
      // Mislabelled or malformed — fall through and try form decoding rather
      // than discarding an enquiry over a Content-Type header.
    }
  }

  if (
    type.includes("application/x-www-form-urlencoded") ||
    /^[^=&\s]+=[^&]*(&|$)/.test(body)
  ) {
    for (const [key, value] of new URLSearchParams(body).entries()) {
      const trimmed = value.trim();
      if (trimmed) fields[key] = trimmed;
    }
  }

  return fields;
}

/** What the admin field-map editor offers, and what the alias table produces. */
export const PORTAL_TARGET_LABEL: Record<PortalTarget, string> = {
  phone: "Phone",
  name: "Full name",
  first_name: "First name",
  last_name: "Last name",
  email: "Email",
  city: "City",
  pincode: "Pincode",
  ignore: "Ignore this field",
};

/** The target a field resolves to, honouring the admin's map over the aliases. */
export function resolveTarget(
  fieldPath: string,
  fieldMap: Record<string, string>,
): { target: PortalTarget | null; customKey: string | null; source: "map" | "alias" | "default" } {
  // The admin's map wins, matched on the full path first and then the leaf, so
  // `lead.mobile` can be mapped either way round.
  const mapped = fieldMap[fieldPath] ?? fieldMap[leafOf(fieldPath)];
  if (mapped) {
    if (KNOWN_TARGETS.has(mapped)) {
      return { target: mapped as PortalTarget, customKey: null, source: "map" };
    }
    return { target: null, customKey: sanitiseKey(mapped), source: "map" };
  }

  // Leaf first, then the whole path. A flattened `lead.contact.Mobile__c`
  // resolves on its leaf; a literal field name that happens to contain a dot
  // resolves on the whole string.
  const aliased =
    ALIASES[normaliseName(leafOf(fieldPath))] ?? ALIASES[normaliseName(fieldPath)];
  if (aliased) return { target: aliased, customKey: null, source: "alias" };

  return { target: null, customKey: sanitiseKey(fieldPath), source: "default" };
}

/**
 * Turn a decoded enquiry into the channel-neutral lead shape.
 *
 * Custom fields land under `custom_data.portal`, so a "project" or a "budget"
 * becomes a registered lead field on first sight and is immediately bindable on
 * the lead sheet. Repeat enquiries OVERWRITE those keys: the panel should show
 * the project this person asked about most recently, which is the one to open
 * the call with. The full history stays in the delivery log.
 */
export function normalisePortalLead(
  fields: Record<string, string>,
  fieldMap: Record<string, string> = {},
  source: LeadSource = "portal_99acres",
): NormalisedLead {
  let phone: string | null = null;
  let name: string | null = null;
  let firstName: string | null = null;
  let lastName: string | null = null;
  let city: string | null = null;
  let pincode: string | null = null;

  const leadData: Record<string, unknown> = {};
  const portal: Record<string, unknown> = {};

  for (const [path, value] of Object.entries(fields)) {
    const { target, customKey } = resolveTarget(path, fieldMap);

    switch (target) {
      case "ignore":
        continue;
      case "phone":
        phone ??= value;
        continue;
      case "name":
        name ??= value;
        continue;
      case "first_name":
        firstName ??= value;
        continue;
      case "last_name":
        lastName ??= value;
        continue;
      case "city":
        city ??= value;
        continue;
      case "pincode":
        pincode ??= value;
        continue;
      case "email":
        leadData.email ??= value;
        continue;
      default:
        if (customKey) portal[customKey] ??= value;
    }
  }

  const stitched = [firstName, lastName].filter(Boolean).join(" ").trim();
  const resolvedName = name ?? (stitched.length > 0 ? stitched : null);

  // Flagged rather than rejected. An email-only enquiry is still worth working,
  // but it cannot be deduped — a second enquiry from the same person will create
  // a second lead — so the gap is recorded as a field, which makes it filterable
  // on the leads table and bindable on the sheet without any display code.
  if (!phone) portal.missing_phone = true;

  const snapshot: IngestSnapshot = {
    lead_data: leadData,
    custom_data: Object.keys(portal).length > 0 ? { portal } : {},
  };

  return {
    phone,
    name: resolvedName,
    city,
    pincode,
    source,
    snapshot,
  };
}

/**
 * Field names observed across recent payloads, with a sample value each.
 *
 * This is what the admin mapping editor is built on. Nobody publishes a schema
 * for these portals, so the deliveries ARE the documentation — this turns them
 * into the configuration screen.
 *
 * Newest payload first, so `sample` shows the most recent value for each key.
 */
export function observedFields(
  payloads: Array<{ contentType?: string | null; body: unknown }>,
): Array<{ path: string; sample: string; seen: number }> {
  const seen = new Map<string, { sample: string; seen: number }>();

  for (const payload of payloads) {
    const fields =
      typeof payload.body === "string"
        ? decodePortalRequest({
            contentType: payload.contentType ?? null,
            rawBody: payload.body,
            searchParams: new URLSearchParams(),
          })
        : flattenPayload(payload.body);

    for (const [path, value] of Object.entries(fields)) {
      const existing = seen.get(path);
      if (existing) existing.seen++;
      else seen.set(path, { sample: value.slice(0, 120), seen: 1 });
    }
  }

  return [...seen.entries()]
    .map(([path, v]) => ({ path, ...v }))
    .sort((a, b) => b.seen - a.seen || a.path.localeCompare(b.path));
}
