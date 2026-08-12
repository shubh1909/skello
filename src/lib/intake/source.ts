import "server-only";

import { randomBytes, timingSafeEqual } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import type { LeadIntakeChannel } from "@/types/lead-intake";

/**
 * Resolving and authenticating an intake endpoint.
 *
 * Service-role throughout: `lead_intake_sources` has RLS on with no
 * authenticated policies, and a webhook has no session to speak of. Tenancy
 * comes from the URL token, never from the payload.
 */

/** The full row, secrets included. Server-side only — never returned to a client. */
export interface IntakeSourceRow {
  id: string;
  organisation_id: string;
  channel: LeadIntakeChannel;
  name: string | null;
  public_token: string;
  credentials: Record<string, unknown>;
  field_map: Record<string, string>;
  enabled: boolean;
}

const SOURCE_COLUMNS =
  "id, organisation_id, channel, name, public_token, credentials, field_map, enabled";

/**
 * A URL-safe token with 256 bits of entropy.
 *
 * On channels with no signature at all (99acres) this token *is* the security
 * boundary, so it is generated here rather than derived from anything
 * guessable, and it is rotatable.
 */
export function generateIntakeToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Look up a source by its URL token.
 *
 * Returns null for unknown *and* disabled sources — the caller cannot tell them
 * apart, and shouldn't be able to. A disabled endpoint that answered
 * differently from an unknown one would confirm the token to whoever probed it.
 */
export async function resolveIntakeSourceByToken(
  token: string,
  channel: LeadIntakeChannel,
): Promise<IntakeSourceRow | null> {
  // Bound the input before it reaches the DB: the column is capped at 128 and
  // an unbounded path segment is free work for anyone who wants to send one.
  if (!token || token.length < 20 || token.length > 128) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("lead_intake_sources")
    .select(SOURCE_COLUMNS)
    .eq("public_token", token)
    .eq("channel", channel)
    .maybeSingle<IntakeSourceRow>();

  if (!data || !data.enabled) return null;
  return data;
}

/**
 * Constant-time string comparison.
 *
 * Length is compared first and returns early — that leaks the length of the
 * expected secret, which is not the secret. Everything after runs in time
 * independent of *where* the first difference is.
 */
export function secretsMatch(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Read one credential as a string, tolerating a malformed jsonb blob. */
export function credential(
  source: IntakeSourceRow,
  key: string,
): string | null {
  const raw = source.credentials?.[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Stamp `last_event_at`.
 *
 * Denormalised on purpose: "when did something last arrive" is the only honest
 * health signal a push integration has, and the Integrations page must not run
 * an aggregate over the whole ledger to render it. Best-effort — a failed stamp
 * must never fail an ingest.
 */
export async function touchIntakeSource(sourceId: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("lead_intake_sources")
    .update({ last_event_at: new Date().toISOString() })
    .eq("id", sourceId);
}
