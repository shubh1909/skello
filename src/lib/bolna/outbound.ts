import "server-only";

import {
  type BolnaLeadPayload,
  extractLead,
} from "@/lib/bolna/extract";
import { mapStatus, writeTranscriptTurns } from "@/lib/bolna/inbound";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CallTranscriptStatus, CallStatus } from "@/types/call";
import type { LeadIntent } from "@/types/lead";

const VALID_INTENTS: readonly LeadIntent[] = ["hot", "warm", "cold"];

function coerceIntent(raw: string | null): LeadIntent | null {
  if (!raw) return null;
  const match = VALID_INTENTS.find((v) => v === raw.trim().toLowerCase());
  return match ?? null;
}

interface RecordOutboundResultArgs {
  externalId: string;
  payload: BolnaLeadPayload;
}

interface RecordOutboundResultResult {
  callId: string | null;
  transcriptStatus: CallTranscriptStatus;
  matchedExisting: boolean;
}

/**
 * Update an outbound call (and optionally its lead) from the post-call
 * webhook payload. The call row was created earlier by `initiateCall`, so we
 * look it up by `bolna_call_id` and patch it with the now-known outcome
 * (status, duration, recording, transcript, etc.). Lead-side data the agent
 * extracted (actionable note, summary, intent) is also flowed back so the
 * operator sees the call's takeaways without opening the transcript.
 *
 * If we can't find the matching call (e.g. the webhook was forwarded for a
 * call we didn't initiate), we silently no-op — there's no inbound fallback
 * here because the caller already routed on `telephony_data.call_type`.
 */
export async function recordOutboundResult(
  args: RecordOutboundResultArgs,
): Promise<RecordOutboundResultResult> {
  const admin = createAdminClient();
  const { payload, externalId } = args;

  const { data: existingCall, error: findErr } = await admin
    .from("calls")
    .select("id, organisation_id, lead_id")
    .eq("bolna_call_id", externalId)
    .maybeSingle<{
      id: string;
      organisation_id: string;
      lead_id: string | null;
    }>();

  if (findErr) {
    console.error("[outbound] call lookup failed", findErr);
    return { callId: null, transcriptStatus: "failed", matchedExisting: false };
  }

  // Bootstrap a row for direct-from-Bolna dials. Our /campaigns and per-lead
  // dial flows pre-insert the row in `calls` so the webhook just patches it;
  // calls placed straight from Bolna's dashboard skip that step. Without
  // this branch the data was being dropped on the floor (see the
  // "no matching call for execution …" warnings).
  let call: {
    id: string;
    organisation_id: string;
    lead_id: string | null;
  } | null = existingCall;
  const matchedExisting = !!existingCall;

  if (!call) {
    const bootstrapped = await bootstrapDirectOutboundCall(
      admin,
      externalId,
      payload,
    );
    if (!bootstrapped) {
      console.warn(
        "[outbound] no matching call and org could not be resolved",
        { externalId, agentId: payload.agent_id ?? null },
      );
      return {
        callId: null,
        transcriptStatus: "skipped",
        matchedExisting: false,
      };
    }
    call = bootstrapped;
  }

  const transcript = payload.transcript ?? null;
  const recordingUrl = payload.telephony_data?.recording_url ?? null;
  const durationSeconds =
    typeof payload.conversation_duration === "number"
      ? Math.round(payload.conversation_duration)
      : null;
  const status: CallStatus = mapStatus(payload.status);
  const transcriptStatus: CallTranscriptStatus = transcript
    ? "ready"
    : "skipped";

  console.log("[outbound] updating call", {
    callId: call.id,
    externalId,
    status,
    durationSeconds,
    hasTranscript: !!transcript,
    hasRecording: !!recordingUrl,
    bootstrapped: !matchedExisting,
  });

  const { error: updateErr } = await admin
    .from("calls")
    .update({
      status,
      duration_seconds: durationSeconds,
      recording_url: recordingUrl,
      transcript,
      transcript_status: transcriptStatus,
      transcript_fetched_at: transcript ? new Date().toISOString() : null,
      ended_at: payload.updated_at ?? null,
      error_message: payload.error_message ?? null,
      summary: payload.summary ?? null,
    })
    .eq("id", call.id);

  if (updateErr) {
    console.error("[outbound] call update failed", updateErr);
    return {
      callId: call.id,
      transcriptStatus: "failed",
      matchedExisting,
    };
  }

  // Flow the extraction back to the linked lead so the operator sees the new
  // takeaways without opening the transcript. We touch only the fields the
  // agent populates — phone, name, etc. were set when the lead was created.
  if (call.lead_id && payload.extracted_data) {
    const extracted = extractLead(payload.extracted_data.lead_data);
    const leadPatch: Record<string, unknown> = {};
    // Direct Bolna dials create a phone-only lead during bootstrap — flow
    // the agent's extracted name through so the operator sees who it was.
    if (extracted.name !== null) leadPatch.name = extracted.name;
    if (extracted.interest !== null) leadPatch.interest = extracted.interest;
    if (extracted.actionable !== null) leadPatch.actionable = extracted.actionable;
    if (extracted.summary !== null) leadPatch.summary = extracted.summary;
    if (recordingUrl) leadPatch.recording_url = recordingUrl;
    const intent = coerceIntent(extracted.lead_intent);
    if (intent !== null) leadPatch.lead_intent = intent;
    if (extracted.connect_on_whatsapp !== null) {
      leadPatch.wants_to_connect_on_watsapp = extracted.connect_on_whatsapp;
    }
    if (extracted.visit_scheduled_at !== null) {
      leadPatch.visit_date_time = extracted.visit_scheduled_at;
    }
    if (extracted.customer_status !== null) {
      leadPatch.customer_status = extracted.customer_status;
    }

    if (Object.keys(leadPatch).length > 0) {
      const { error: leadErr } = await admin
        .from("leads")
        .update(leadPatch)
        .eq("id", call.lead_id);
      if (leadErr) console.error("[outbound] lead patch failed", leadErr);
    }
  }

  const finalStatus = await writeTranscriptTurns(
    call.id,
    call.organisation_id,
    transcript,
  );
  return {
    callId: call.id,
    transcriptStatus: finalStatus,
    matchedExisting,
  };
}

/**
 * Insert a fresh `calls` row for a webhook that arrived without a pre-existing
 * record. We resolve the tenant via `agent_id` → `bolna_integrations` (matching
 * either the default `agent_id` or the additional `agent_ids[]` column), then
 * insert with the basics (phones, agent, direction). The caller patches the
 * outcome fields (status, transcript, …) immediately after.
 *
 * Returns null when the org can't be resolved — most likely the agent isn't
 * registered to any workspace, so writing the row would orphan it.
 *
 * Idempotency: `calls` has UNIQUE (organisation_id, bolna_call_id), so a
 * duplicate webhook delivery is rejected by the DB. We swallow that error
 * and refetch the existing row.
 */
async function bootstrapDirectOutboundCall(
  admin: ReturnType<typeof createAdminClient>,
  externalId: string,
  payload: BolnaLeadPayload,
): Promise<{
  id: string;
  organisation_id: string;
  lead_id: string | null;
} | null> {
  const agentId = payload.agent_id?.trim();
  if (!agentId) return null;

  // Match either the default agent_id column or an entry in the additional
  // `agent_ids[]` array (campaigns can pick from a list of agents).
  const { data: integration, error: intErr } = await admin
    .from("bolna_integrations")
    .select("organisation_id")
    .or(`agent_id.eq.${agentId},agent_ids.cs.{${agentId}}`)
    .maybeSingle<{ organisation_id: string }>();

  if (intErr) {
    console.error("[outbound] integration lookup failed", intErr);
    return null;
  }
  if (!integration) return null;

  // For outbound, the customer's number is `to_number` on telephony_data.
  // Bolna also exposes it as `user_number` at the payload root, which is a
  // safe fallback if telephony_data is partially populated.
  const toPhone =
    payload.telephony_data?.to_number?.trim() ||
    payload.user_number?.trim() ||
    null;
  const fromPhone =
    payload.telephony_data?.from_number?.trim() ||
    payload.agent_number?.trim() ||
    null;

  // Prefer Bolna's `initiated_at` — that's when the dial actually started.
  // Falling back to `created_at` (when Bolna recorded the call) before the
  // DB default of `now()`, which would be the webhook-arrival time.
  const startedAt = payload.initiated_at ?? payload.created_at ?? null;

  // Resolve a lead for the dialled number before we insert the call so the
  // FK gets populated on first write. If the customer doesn't exist yet,
  // we create them — direct dials from Bolna's dashboard are still leads
  // worth tracking, even if no Skelo UI flow ever touched them.
  const leadId = await findOrCreateLeadForOutbound(
    admin,
    integration.organisation_id,
    toPhone,
  );

  const { data: inserted, error: insertErr } = await admin
    .from("calls")
    .insert({
      organisation_id: integration.organisation_id,
      bolna_call_id: externalId,
      agent_id: agentId,
      direction: "outbound",
      to_phone: toPhone,
      from_phone: fromPhone,
      status: "initiated",
      lead_id: leadId,
      ...(startedAt ? { started_at: startedAt } : {}),
    })
    .select("id, organisation_id, lead_id")
    .single<{
      id: string;
      organisation_id: string;
      lead_id: string | null;
    }>();

  if (!insertErr && inserted) return inserted;

  // Unique-violation (23505) means the row already exists — a sibling webhook
  // delivery beat us to it. Refetch and continue with the patch path.
  if (insertErr && insertErr.code === "23505") {
    const { data: refetched } = await admin
      .from("calls")
      .select("id, organisation_id, lead_id")
      .eq("organisation_id", integration.organisation_id)
      .eq("bolna_call_id", externalId)
      .maybeSingle<{
        id: string;
        organisation_id: string;
        lead_id: string | null;
      }>();
    if (refetched) return refetched;
  }

  console.error("[outbound] bootstrap insert failed", insertErr);
  return null;
}

/**
 * Find or create the lead this outbound call should attach to.
 *
 * Lookup strategy (in order):
 *   1. Exact match on digit-only phone — catches leads we created from a
 *      prior outbound bootstrap (we store digits-only there).
 *   2. Fuzzy match on the last 10 digits — catches leads created elsewhere
 *      with country-code or formatted phones (e.g. "+91 98765 43210"). This
 *      uses ilike, which sequentially scans the org's leads; fine at our
 *      current scale (thousands per org).
 *
 * Create path:
 *   No match → insert a fresh lead with `source = 'manual'` (closest enum
 *   value; `lead_source` doesn't have an "outbound_call" entry) and
 *   `status = 'contacted'` (we've reached out, even if not yet connected).
 *   The phone is stored digits-only so subsequent outbound calls re-match
 *   without going through the fuzzy path.
 *
 * Returns null when:
 *   - The phone is missing or too short to be a real number.
 *   - The org slug can't be resolved (shouldn't happen if the integration
 *     row pointed at a real org, but we defensive-null instead of throwing).
 *   - The insert errored — we log and let the call row save without a
 *     lead_id rather than failing the whole webhook.
 */
async function findOrCreateLeadForOutbound(
  admin: ReturnType<typeof createAdminClient>,
  organisationId: string,
  toPhone: string | null,
): Promise<string | null> {
  if (!toPhone) return null;

  const digits = toPhone.replace(/[^0-9]/g, "");
  if (digits.length < 5) return null;

  const { data: org } = await admin
    .from("organisations")
    .select("slug")
    .eq("id", organisationId)
    .maybeSingle<{ slug: string }>();
  if (!org) return null;

  // 1. Exact digit-only match.
  const { data: exact } = await admin
    .from("leads")
    .select("id")
    .eq("org_slug", org.slug)
    .eq("phone", digits)
    .limit(1);
  if (exact && exact.length > 0) return exact[0].id;

  // 2. Fuzzy last-10-digits match (only run if we have enough digits to be
  //    discriminating — otherwise we'd match too much).
  const last10 = digits.slice(-10);
  if (last10.length >= 7) {
    const { data: fuzzy } = await admin
      .from("leads")
      .select("id")
      .eq("org_slug", org.slug)
      .ilike("phone", `%${last10}%`)
      .order("created_at", { ascending: false })
      .limit(1);
    if (fuzzy && fuzzy.length > 0) return fuzzy[0].id;
  }

  // 3. Create.
  const { data: created, error } = await admin
    .from("leads")
    .insert({
      org_slug: org.slug,
      phone: digits,
      source: "manual",
      status: "contacted",
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    console.error("[outbound] lead bootstrap failed", error);
    return null;
  }
  console.log("[outbound] created lead from direct dial", {
    leadId: created.id,
    phone: digits,
  });
  return created.id;
}
