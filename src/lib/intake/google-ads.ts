import type { IngestSnapshot, NormalisedLead } from "@/lib/leads/ingest";

/**
 * Google Ads lead form webhook — payload parsing and normalisation.
 *
 * Pure. No DB, no `server-only`: the route does the I/O, this file does the
 * shape work, and the shape work is what needs tests.
 *
 * Contract: https://developers.google.com/google-ads/webhook/docs/implementation
 */

/** One answer from the form. `column_id` is Google's, or the advertiser's for a custom question. */
export interface GoogleAdsUserColumn {
  column_id: string;
  string_value: string;
  column_name?: string;
}

export interface GoogleAdsLeadPayload {
  lead_id: string;
  user_column_data: GoogleAdsUserColumn[];
  google_key: string | null;
  is_test: boolean;
  api_version: string | null;
  form_id: string | null;
  campaign_id: string | null;
  adgroup_id: string | null;
  creative_id: string | null;
  asset_group_id: string | null;
  gcl_id: string | null;
  lead_stage: string | null;
  lead_submit_time: string | null;
  /** "LEAD_FORM" | "CONVERSATIONAL_AGENT" — Google's own field, not ours. */
  lead_source: string | null;
}

/**
 * Where one form answer goes.
 *
 * Anything not in this union is treated as a custom key under the uncategorised
 * `custom_data['']` bucket — which is the common case, because a real-estate
 * advertiser's qualifying questions ("budget?", "possession timeline?") arrive
 * with ids we cannot know in advance.
 */
export type GoogleAdsFieldTarget =
  | "name"
  | "first_name"
  | "last_name"
  | "phone"
  | "email"
  | "city"
  | "pincode"
  | "ignore";

const KNOWN_TARGETS = new Set<string>([
  "name",
  "first_name",
  "last_name",
  "phone",
  "email",
  "city",
  "pincode",
  "ignore",
]);

/**
 * Google's documented `column_id` values, mapped to lead fields.
 *
 * Hardcoded rather than configured because this set IS fixed — it is Google's
 * enum, not an advertiser's naming choice. (99acres is the opposite case, and
 * that is what `lead_intake_sources.field_map` is for.) An admin can still
 * override any row here through that map.
 */
export const DEFAULT_GOOGLE_COLUMN_MAP: Record<string, GoogleAdsFieldTarget> = {
  FULL_NAME: "name",
  FIRST_NAME: "first_name",
  LAST_NAME: "last_name",
  PHONE_NUMBER: "phone",
  WORK_PHONE: "phone",
  EMAIL: "email",
  WORK_EMAIL: "email",
  CITY: "city",
  POSTAL_CODE: "pincode",
};

function str(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  // int64 ids arrive as JSON numbers from some surfaces and as strings from
  // others. Both are identifiers to us, never arithmetic.
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * Parse Google's POST body.
 *
 * Deliberately tolerant: Google reserves the right to add optional fields, and
 * a parser that rejects unknown keys would break on a non-breaking change from
 * their side. We require exactly one thing — `lead_id` — because without it we
 * cannot deduplicate, and Google does not promise exactly-once delivery.
 *
 * Returns null when the body isn't a Google lead at all, which the route turns
 * into a 4xx (never retried) rather than a 5xx.
 */
export function parseGoogleAdsPayload(
  body: unknown,
): GoogleAdsLeadPayload | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;

  const leadId = str(b.lead_id);
  if (!leadId) return null;

  const columns: GoogleAdsUserColumn[] = [];
  if (Array.isArray(b.user_column_data)) {
    for (const raw of b.user_column_data) {
      if (!raw || typeof raw !== "object") continue;
      const c = raw as Record<string, unknown>;
      const columnId = str(c.column_id);
      const value = str(c.string_value);
      if (!columnId || value === null) continue;
      columns.push({
        column_id: columnId,
        string_value: value,
        ...(str(c.column_name) ? { column_name: str(c.column_name) as string } : {}),
      });
    }
  }

  return {
    lead_id: leadId,
    user_column_data: columns,
    google_key: str(b.google_key),
    // Absent or false both mean production. Only an explicit `true` is a test.
    is_test: b.is_test === true,
    api_version: str(b.api_version),
    form_id: str(b.form_id),
    campaign_id: str(b.campaign_id),
    adgroup_id: str(b.adgroup_id),
    creative_id: str(b.creative_id),
    asset_group_id: str(b.asset_group_id),
    gcl_id: str(b.gcl_id),
    lead_stage: str(b.lead_stage),
    lead_submit_time: str(b.lead_submit_time),
    lead_source: str(b.lead_source),
  };
}

/**
 * A JSONB key safe to store and to address from a lead-sheet binding.
 *
 * Binding key paths are validated against `[a-zA-Z0-9_\-.]+`, so a custom
 * question id with a space or a bracket would register a field nobody could
 * ever bind to. Sanitising here keeps the catalog addressable.
 */
export function sanitiseKey(raw: string): string {
  return (
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "field"
  );
}

/**
 * Turn a parsed payload into the channel-neutral lead shape.
 *
 * `fieldMap` overrides `DEFAULT_GOOGLE_COLUMN_MAP` per source; a value that
 * isn't a known target is used as a custom key, so an admin can rename
 * "QUESTION_1" to "budget" without code.
 *
 * Every answer we don't recognise still lands in `custom_data['']`, where the
 * field catalog picks it up on first sight — so a new qualifying question shows
 * up as a bindable lead field with no deploy.
 */
export function normaliseGoogleAdsLead(
  payload: GoogleAdsLeadPayload,
  fieldMap: Record<string, string> = {},
): NormalisedLead {
  let name: string | null = null;
  let firstName: string | null = null;
  let lastName: string | null = null;
  let phone: string | null = null;
  let city: string | null = null;
  let pincode: string | null = null;

  const leadData: Record<string, unknown> = {};
  const uncategorised: Record<string, unknown> = {};

  for (const col of payload.user_column_data) {
    const mapped = fieldMap[col.column_id] ?? DEFAULT_GOOGLE_COLUMN_MAP[col.column_id];
    const target = mapped && KNOWN_TARGETS.has(mapped) ? mapped : null;

    switch (target) {
      case "ignore":
        continue;
      case "name":
        name ??= col.string_value;
        continue;
      case "first_name":
        firstName ??= col.string_value;
        continue;
      case "last_name":
        lastName ??= col.string_value;
        continue;
      case "phone":
        // First wins: PHONE_NUMBER precedes WORK_PHONE in Google's own
        // ordering, and a personal number is the one worth calling.
        phone ??= col.string_value;
        continue;
      case "city":
        city ??= col.string_value;
        continue;
      case "pincode":
        pincode ??= col.string_value;
        continue;
      case "email":
        // `email` is a first-class extraction key elsewhere in the app, so it
        // belongs in lead_data rather than the custom bucket.
        leadData.email ??= col.string_value;
        continue;
      default: {
        // An admin-mapped name that isn't a known target is a custom key.
        const key = sanitiseKey(mapped && !KNOWN_TARGETS.has(mapped) ? mapped : col.column_id);
        uncategorised[key] ??= col.string_value;
      }
    }
  }

  // FULL_NAME wins if the form asked for it; otherwise stitch the parts. A form
  // with only a last name still yields something better than nothing.
  const stitched = [firstName, lastName].filter(Boolean).join(" ").trim();
  const resolvedName = name ?? (stitched.length > 0 ? stitched : null);

  // The attribution trail back to ad spend. Its own category so it stays out of
  // the "what they told us" bucket the lead sheet reads from.
  const attribution: Record<string, unknown> = {};
  const attribute = (key: string, value: string | null) => {
    if (value !== null) attribution[key] = value;
  };
  attribute("lead_id", payload.lead_id);
  attribute("form_id", payload.form_id);
  attribute("campaign_id", payload.campaign_id);
  attribute("adgroup_id", payload.adgroup_id);
  attribute("creative_id", payload.creative_id);
  attribute("asset_group_id", payload.asset_group_id);
  attribute("gcl_id", payload.gcl_id);
  attribute("lead_stage", payload.lead_stage);
  attribute("submitted_at", payload.lead_submit_time);

  const snapshot: IngestSnapshot = {
    lead_data: leadData,
    custom_data: {
      ...(Object.keys(uncategorised).length > 0 ? { "": uncategorised } : {}),
      ...(Object.keys(attribution).length > 0 ? { google_ads: attribution } : {}),
    },
  };

  return {
    phone,
    name: resolvedName,
    city,
    pincode,
    source: "google_ads",
    snapshot,
  };
}
