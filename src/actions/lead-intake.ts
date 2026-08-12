"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";

import { requireUser, userCanManageOrg } from "@/lib/auth/org-access";
import { requireSession } from "@/lib/auth/session";
import { logSkeloError } from "@/lib/errors";
import { generateIntakeToken } from "@/lib/intake/source";
import {
  normaliseGoogleAdsLead,
  parseGoogleAdsPayload,
} from "@/lib/intake/google-ads";
import { ingestNormalisedLead } from "@/lib/leads/ingest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  createIntakeSourceSchema,
  intakeSourceIdSchema,
  listIntakeEventsSchema,
  listIntakeSourcesForOrgSchema,
  replayIntakeEventSchema,
  updateIntakeSourceSchema,
} from "@/lib/validations/lead-intake";
import { type ActionResult, fail, ok } from "@/types/action";
import {
  WRITABLE_CREDENTIALS,
  type LeadIntakeChannel,
  type LeadIntakeEvent,
  type LeadIntakeSource,
} from "@/types/lead-intake";

/**
 * Lead-intake configuration.
 *
 * **Two audiences, deliberately different powers.** Reading is customer-facing
 * and session-scoped: an org owner sees their endpoints, their delivery log, and
 * can re-run a failed delivery. Creating and configuring is Skelo-team work,
 * takes an explicit `organisation_id`, and is gated by `userCanManageOrg` —
 * matching how voice agents and Shopify are already provisioned. That split is
 * why WhatsApp credentials never appear on a form an org owner can reach.
 *
 * Everything uses the service-role client because `lead_intake_sources` has RLS
 * on with no authenticated policies (it holds secrets), so every query scopes
 * `organisation_id` by hand. The one exception is the delivery log, which has a
 * real SELECT policy and reads through the cookie client.
 */

interface SourceRow {
  id: string;
  organisation_id: string;
  channel: LeadIntakeChannel;
  name: string | null;
  public_token: string;
  credentials: Record<string, unknown> | null;
  field_map: Record<string, string> | null;
  enabled: boolean;
  last_event_at: string | null;
  created_at: string;
  updated_at: string;
}

const SOURCE_COLUMNS =
  "id, organisation_id, channel, name, public_token, credentials, field_map, " +
  "enabled, last_event_at, created_at, updated_at";

const EVENT_COLUMNS =
  "id, organisation_id, source_id, channel, external_id, status, lead_id, " +
  "payload, error, received_at, processed_at";

/**
 * The secret Skelo issues for a channel, which somebody then pastes into the
 * provider's console. This is the ONLY credential ever returned to a client.
 *
 * Google's is the key its webhook echoes back in the body; Meta's is the token
 * it presents during the subscription handshake. Everything else on a source is
 * the client's own secret, held on their behalf and never re-read.
 */
const SELF_ISSUED_CREDENTIAL: Partial<Record<LeadIntakeChannel, string>> = {
  google_ads: "google_key",
  whatsapp: "verify_token",
};

function redact(row: SourceRow): LeadIntakeSource {
  const selfIssued = SELF_ISSUED_CREDENTIAL[row.channel];
  const credentials = row.credentials ?? {};
  const raw = selfIssued ? credentials[selfIssued] : null;

  return {
    id: row.id,
    organisation_id: row.organisation_id,
    channel: row.channel,
    name: row.name,
    public_token: row.public_token,
    shared_key: typeof raw === "string" ? raw : null,
    // Names only, never values — enough for the editor to show what is set.
    configured_credentials: WRITABLE_CREDENTIALS[row.channel].filter(
      (key) => typeof credentials[key] === "string" && credentials[key] !== "",
    ),
    field_map: row.field_map ?? {},
    enabled: row.enabled,
    last_event_at: row.last_event_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Auth for every configuration action: platform admin, or the org's owner. */
async function requireOrgManager(
  organisationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not authenticated" };
  if (!(await userCanManageOrg(supabase, user.id, organisationId))) {
    return { ok: false, error: "Forbidden" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Customer-facing reads
// ---------------------------------------------------------------------------

/** The signed-in org's endpoints, for /integrations. Read-only by design. */
export async function listIntakeSources(): Promise<
  ActionResult<LeadIntakeSource[]>
> {
  const session = await requireSession();
  return loadSources(session.organisation.id);
}

/** The same list for the admin editor, against an explicit org. */
export async function listIntakeSourcesForOrg(
  input: unknown,
): Promise<ActionResult<LeadIntakeSource[]>> {
  const parsed = listIntakeSourcesForOrgSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const auth = await requireOrgManager(parsed.data.organisation_id);
  if (!auth.ok) return fail(auth.error);
  return loadSources(parsed.data.organisation_id);
}

async function loadSources(
  organisationId: string,
): Promise<ActionResult<LeadIntakeSource[]>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("lead_intake_sources")
    .select(SOURCE_COLUMNS)
    .eq("organisation_id", organisationId)
    .order("created_at", { ascending: true })
    .returns<SourceRow[]>();

  if (error) {
    return fail(
      logSkeloError("WEBHOOK-INGEST", "Could not load integrations", {
        organisationId,
        cause: error,
      }),
    );
  }
  return ok((data ?? []).map(redact));
}

// ---------------------------------------------------------------------------
// Configuration — Skelo team only
// ---------------------------------------------------------------------------

/**
 * Create an endpoint, issuing its URL token and its self-issued secret.
 *
 * The secret is generated, never chosen. Google accepts any string as its key,
 * and a field a human fills in ends up being the company name — the first thing
 * anyone probing the endpoint would try.
 */
export async function createIntakeSource(
  input: unknown,
): Promise<ActionResult<LeadIntakeSource>> {
  const parsed = createIntakeSourceSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const auth = await requireOrgManager(parsed.data.organisation_id);
  if (!auth.ok) return fail(auth.error);

  const admin = createAdminClient();
  const credentials: Record<string, string> = {};
  const selfIssued = SELF_ISSUED_CREDENTIAL[parsed.data.channel];
  if (selfIssued) credentials[selfIssued] = randomBytes(24).toString("base64url");

  const { data, error } = await admin
    .from("lead_intake_sources")
    .insert({
      organisation_id: parsed.data.organisation_id,
      channel: parsed.data.channel,
      name: parsed.data.name ?? null,
      public_token: generateIntakeToken(),
      credentials,
    })
    .select(SOURCE_COLUMNS)
    .single<SourceRow>();

  if (error || !data) {
    return fail(
      logSkeloError("WEBHOOK-INGEST", "Could not create the integration", {
        organisationId: parsed.data.organisation_id,
        cause: error,
      }),
    );
  }

  revalidateIntake(parsed.data.organisation_id);
  return ok(redact(data));
}

export async function updateIntakeSource(
  input: unknown,
): Promise<ActionResult<LeadIntakeSource>> {
  const parsed = updateIntakeSourceSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const v = parsed.data;
  const auth = await requireOrgManager(v.organisation_id);
  if (!auth.ok) return fail(auth.error);

  const admin = createAdminClient();

  // Read first: `credentials` is one jsonb blob, so setting a single key means
  // merging. A blind write would drop every other credential on the row.
  const { data: current } = await admin
    .from("lead_intake_sources")
    .select("credentials, channel")
    .eq("id", v.id)
    .eq("organisation_id", v.organisation_id)
    .maybeSingle<{
      credentials: Record<string, unknown> | null;
      channel: LeadIntakeChannel;
    }>();

  if (!current) return fail("Integration not found");

  const patch: Record<string, unknown> = {};
  if (v.name !== undefined) patch.name = v.name ?? null;
  if (v.enabled !== undefined) patch.enabled = v.enabled;
  if (v.field_map !== undefined) patch.field_map = v.field_map;

  if (v.credentials !== undefined) {
    // Allowlist by channel. An unrecognised key is rejected outright rather
    // than dropped silently — a typo'd `app_secrete` that saved cleanly would
    // leave the endpoint failing every signature with no clue why.
    const allowed = new Set(WRITABLE_CREDENTIALS[current.channel]);
    const rejected = Object.keys(v.credentials).filter((k) => !allowed.has(k));
    if (rejected.length > 0) {
      return fail(`Not a credential for this integration: ${rejected.join(", ")}`);
    }
    patch.credentials = { ...(current.credentials ?? {}), ...v.credentials };
  }

  if (Object.keys(patch).length === 0) return fail("Nothing to update");

  const { data, error } = await admin
    .from("lead_intake_sources")
    .update(patch)
    .eq("id", v.id)
    .eq("organisation_id", v.organisation_id)
    .select(SOURCE_COLUMNS)
    .single<SourceRow>();

  if (error || !data) {
    return fail(
      logSkeloError("WEBHOOK-INGEST", "Could not update the integration", {
        organisationId: v.organisation_id,
        cause: error,
      }),
    );
  }

  revalidateIntake(v.organisation_id);
  return ok(redact(data));
}

/**
 * Issue a new URL, and a new self-issued secret with it.
 *
 * The answer to a leaked endpoint — and on a channel with no signature, the only
 * answer. Destructive on purpose: deliveries to the old URL stop resolving the
 * moment this runs, so the new one has to be pasted back into the provider's
 * console. Rotating the key alongside the token means one leak needs one fix,
 * not two.
 */
export async function rotateIntakeToken(
  input: unknown,
): Promise<ActionResult<LeadIntakeSource>> {
  const parsed = intakeSourceIdSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const auth = await requireOrgManager(parsed.data.organisation_id);
  if (!auth.ok) return fail(auth.error);

  const admin = createAdminClient();
  const { data: current } = await admin
    .from("lead_intake_sources")
    .select("credentials, channel")
    .eq("id", parsed.data.id)
    .eq("organisation_id", parsed.data.organisation_id)
    .maybeSingle<{
      credentials: Record<string, unknown> | null;
      channel: LeadIntakeChannel;
    }>();

  if (!current) return fail("Integration not found");

  const patch: Record<string, unknown> = { public_token: generateIntakeToken() };
  const selfIssued = SELF_ISSUED_CREDENTIAL[current.channel];
  if (selfIssued) {
    patch.credentials = {
      ...(current.credentials ?? {}),
      [selfIssued]: randomBytes(24).toString("base64url"),
    };
  }

  const { data, error } = await admin
    .from("lead_intake_sources")
    .update(patch)
    .eq("id", parsed.data.id)
    .eq("organisation_id", parsed.data.organisation_id)
    .select(SOURCE_COLUMNS)
    .single<SourceRow>();

  if (error || !data) {
    return fail(
      logSkeloError("WEBHOOK-INGEST", "Could not rotate the endpoint", {
        organisationId: parsed.data.organisation_id,
        cause: error,
      }),
    );
  }

  revalidateIntake(parsed.data.organisation_id);
  return ok(redact(data));
}

export async function deleteIntakeSource(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = intakeSourceIdSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const auth = await requireOrgManager(parsed.data.organisation_id);
  if (!auth.ok) return fail(auth.error);

  const admin = createAdminClient();
  const { error } = await admin
    .from("lead_intake_sources")
    .delete()
    .eq("id", parsed.data.id)
    .eq("organisation_id", parsed.data.organisation_id);

  if (error) {
    return fail(
      logSkeloError("WEBHOOK-INGEST", "Could not remove the integration", {
        organisationId: parsed.data.organisation_id,
        cause: error,
      }),
    );
  }

  revalidateIntake(parsed.data.organisation_id);
  return ok({ id: parsed.data.id });
}

// ---------------------------------------------------------------------------
// Delivery log
// ---------------------------------------------------------------------------

/**
 * Cookie client on purpose: `lead_intake_events` has an authenticated SELECT
 * policy for org owners, so RLS is the gate and this read carries no secrets.
 * The `organisation_id` filter is still explicit — RLS is the safety net, not
 * the primary gate.
 */
export async function listIntakeEvents(
  input: unknown,
): Promise<ActionResult<{ items: LeadIntakeEvent[]; total: number }>> {
  const parsed = listIntakeEventsSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const session = await requireSession();
  const supabase = await createClient();
  const { limit, offset, source_id } = parsed.data;

  let query = supabase
    .from("lead_intake_events")
    .select(EVENT_COLUMNS, { count: "exact" })
    .eq("organisation_id", session.organisation.id);

  if (source_id) query = query.eq("source_id", source_id);

  const { data, error, count } = await query
    .order("received_at", { ascending: false })
    .range(offset, offset + limit - 1)
    .returns<LeadIntakeEvent[]>();

  if (error) {
    return fail(
      logSkeloError("WEBHOOK-INGEST", "Could not load the delivery log", {
        organisationId: session.organisation.id,
        cause: error,
      }),
    );
  }

  return ok({ items: data ?? [], total: count ?? 0 });
}

/**
 * Re-run ingest from a stored payload.
 *
 * The reason raw bodies are kept. A wrong field map, an ingest that died
 * half-way — both cost a re-run rather than a lost lead. Idempotent by
 * construction: ingest is find-or-create, so replaying updates the same lead.
 *
 * Customer-facing, unlike the configuration actions: re-running a delivery is
 * operational, not a change to how anything is wired.
 */
export async function replayIntakeEvent(
  input: unknown,
): Promise<ActionResult<{ leadId: string }>> {
  const parsed = replayIntakeEventSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const session = await requireSession();
  const admin = createAdminClient();

  const { data: event } = await admin
    .from("lead_intake_events")
    .select("id, source_id, channel, payload, status")
    .eq("id", parsed.data.id)
    .eq("organisation_id", session.organisation.id)
    .maybeSingle<{
      id: string;
      source_id: string;
      channel: LeadIntakeChannel;
      payload: unknown;
      status: string;
    }>();

  if (!event) return fail("Delivery not found");
  if (event.channel !== "google_ads") {
    return fail("Re-running is only available for Google Ads deliveries");
  }
  // A test lead stays a test lead on replay. Google sends it to prove the
  // endpoint answers, not to add anyone to the pipeline.
  if (event.status === "test") {
    return fail("Test deliveries are not turned into leads");
  }

  const { data: source } = await admin
    .from("lead_intake_sources")
    .select("field_map")
    .eq("id", event.source_id)
    .eq("organisation_id", session.organisation.id)
    .maybeSingle<{ field_map: Record<string, string> | null }>();

  const payload = parseGoogleAdsPayload(event.payload);
  if (!payload) return fail("Stored payload is not a Google Ads lead");

  try {
    const { leadId } = await ingestNormalisedLead({
      organisationId: session.organisation.id,
      lead: normaliseGoogleAdsLead(payload, source?.field_map ?? {}),
    });

    await admin
      .from("lead_intake_events")
      .update({
        status: "processed",
        lead_id: leadId,
        error: null,
        processed_at: new Date().toISOString(),
      })
      .eq("id", event.id)
      .eq("organisation_id", session.organisation.id);

    revalidatePath("/integrations");
    revalidatePath("/leads");
    return ok({ leadId });
  } catch (err) {
    return fail(
      logSkeloError("WEBHOOK-INGEST", "Replay failed", {
        organisationId: session.organisation.id,
        cause: err,
      }),
    );
  }
}

function revalidateIntake(organisationId: string): void {
  revalidatePath("/integrations");
  revalidatePath(`/admin/organisations/${organisationId}/integrations`);
}
