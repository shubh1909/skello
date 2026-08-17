/**
 * Lead intake — non-voice lead sources (Google Ads, WhatsApp CTWA, portals).
 *
 * The voice agent is deliberately NOT a channel here. It has its own webhook
 * contract, its own per-call snapshot on `calls`, and a richer merge; bending it
 * to fit the simplest sources would cost more than it saves.
 */

/** Which integration a source speaks. Mirrors the DB's channel CHECK. */
export type LeadIntakeChannel = "google_ads" | "whatsapp" | "portal_99acres";

export const LEAD_INTAKE_CHANNELS: readonly LeadIntakeChannel[] = [
  "google_ads",
  "whatsapp",
  "portal_99acres",
];

/**
 * What happened to one delivery.
 *
 * - `received`   accepted, ingest not finished (or crashed mid-flight)
 * - `processed`  a lead was created or updated
 * - `duplicate`  we had already seen this external_id
 * - `test`       provider's own test payload — deliberately creates no lead
 * - `ignored`    valid, but our rules said do nothing (e.g. a known WhatsApp
 *                sender with no ad referral)
 * - `failed`     we could not turn it into a lead; the raw payload is kept
 */
export type LeadIntakeEventStatus =
  | "received"
  | "processed"
  | "duplicate"
  | "test"
  | "ignored"
  | "failed";

/**
 * A configured endpoint, as every action returns it.
 *
 * ⚠️ `credentials` is REDACTED and this type reflects that. Only `shared_key` —
 * the secret Skelo itself issues, which somebody has to paste into Google Ads or
 * Meta — ever crosses the wire. Secrets we hold on a client's behalf (a Meta app
 * secret, an access token, a portal api_key) have no field here at all, so
 * there is nowhere for them to leak into a payload.
 *
 * `configured_credentials` names which of those are set, without their values,
 * so the admin editor can show "app secret · set" and let it be replaced.
 */
export interface LeadIntakeSource {
  id: string;
  organisation_id: string;
  channel: LeadIntakeChannel;
  name: string | null;
  public_token: string;
  /** The secret Skelo issues. Null on channels that don't have one. */
  shared_key: string | null;
  configured_credentials: string[];
  field_map: Record<string, string>;
  enabled: boolean;
  last_event_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Credentials the client supplies, per channel — the allowlist for writes.
 *
 * Anything not named here is refused rather than merged into the jsonb blob,
 * so an unfiltered payload can't quietly plant a key the webhook later reads.
 * `verify_token` and `google_key` are absent on purpose: Skelo issues those.
 */
export const WRITABLE_CREDENTIALS: Record<LeadIntakeChannel, readonly string[]> =
  {
    google_ads: [],
    whatsapp: ["app_secret", "access_token", "phone_number_id", "waba_id"],
    // Both optional. A portal signs nothing, so the URL token is the real gate;
    // these narrow it further when the account happens to support them.
    portal_99acres: ["api_key", "allowed_ips"],
  };

/** Credentials that are optional — the endpoint works without them. */
export const OPTIONAL_CREDENTIALS: Record<LeadIntakeChannel, readonly string[]> =
  {
    google_ads: [],
    whatsapp: ["waba_id"],
    portal_99acres: ["api_key", "allowed_ips"],
  };

export const CREDENTIAL_LABEL: Record<string, string> = {
  app_secret: "Meta app secret",
  access_token: "System user access token",
  phone_number_id: "Phone number ID",
  waba_id: "WhatsApp Business Account ID",
  api_key: "Portal API key",
  allowed_ips: "Allowed IP addresses",
};

export const CREDENTIAL_HINT: Record<string, string> = {
  api_key:
    "Only if the portal account sends one. Checked against ?api_key= or an X-Api-Key header.",
  allowed_ips:
    "Comma-separated. Leave blank to accept from anywhere — the URL token is still required.",
};

export interface LeadIntakeEvent {
  id: string;
  organisation_id: string;
  source_id: string;
  channel: LeadIntakeChannel;
  external_id: string | null;
  status: LeadIntakeEventStatus;
  lead_id: string | null;
  payload: unknown;
  error: string | null;
  received_at: string;
  processed_at: string | null;
}

/**
 * One field name a portal endpoint has been observed sending.
 *
 * `source` says how it currently resolves: `map` is what an admin chose,
 * `alias` is our guess from the built-in table, `default` is "kept as a custom
 * field under its own name". The guesses are the ones worth reviewing.
 */
export interface ObservedPortalField {
  path: string;
  sample: string;
  seen: number;
  target: string | null;
  customKey: string | null;
  source: "map" | "alias" | "default";
}

export const LEAD_INTAKE_CHANNEL_LABEL: Record<LeadIntakeChannel, string> = {
  google_ads: "Google Ads",
  whatsapp: "WhatsApp",
  portal_99acres: "99acres",
};

export const LEAD_INTAKE_STATUS_LABEL: Record<LeadIntakeEventStatus, string> = {
  received: "Received",
  processed: "Lead created",
  duplicate: "Duplicate",
  test: "Test",
  ignored: "Ignored",
  failed: "Failed",
};
