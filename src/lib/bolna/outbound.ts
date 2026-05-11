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

  const toPhone = payload.telephony_data?.to_number?.trim() ?? null;
  const fromPhone = payload.telephony_data?.from_number?.trim() ?? null;

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
