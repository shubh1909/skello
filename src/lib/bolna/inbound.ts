import "server-only";

import type { BolnaLeadPayload } from "@/lib/bolna/extract";
import { mergePayloadIntoLead } from "@/lib/bolna/lead-merge";
import { parseTranscript } from "@/lib/bolna/transcript";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseProviderTimestamp } from "@/lib/time";
import type { CallOutcome, CallStatus, CallTranscriptStatus } from "@/types/call";

interface RecordInboundCallArgs {
  organisationId: string;
  externalId: string;
  payload: BolnaLeadPayload;
  // Disposition extracted by the route (it already runs extractLead). Persisted
  // on the inbound call row so the Conversations disposition column and the
  // callback scheduler both read it from one place.
  callOutcome?: CallOutcome | null;
  requestedCallbackAt?: string | null;
}

interface RecordInboundCallResult {
  callId: string | null;
  leadId: string | null;
  transcriptStatus: CallTranscriptStatus;
  leadCreated: boolean;
}

const STATUS_MAP: Record<string, CallStatus> = {
  completed: "completed",
  ended: "completed",
  "in-progress": "in_progress",
  in_progress: "in_progress",
  ringing: "ringing",
  initiated: "initiated",
  failed: "failed",
  "no-answer": "no_answer",
  no_answer: "no_answer",
  busy: "busy",
  canceled: "canceled",
  cancelled: "canceled",
  "call-disconnected": "completed",
};

export function mapStatus(raw: string | null | undefined): CallStatus {
  if (!raw) return "completed";
  return STATUS_MAP[raw.toLowerCase()] ?? "completed";
}

/**
 * Persist an inbound call from the post-call webhook payload.
 *
 * Post-remodel contract:
 *   1. Find-or-create the lead by (organisation_id, phone_normalized).
 *      The phone comes from `payload.user_number` (provider-sent metadata,
 *      not LLM-extracted).
 *   2. Build the per-call snapshot from extracted_data.lead_data.
 *   3. Merge the snapshot onto the lead's "current view" columns +
 *      lead_data/custom_data jsonb, respecting lead_field_overrides.
 *   4. Insert the calls row with the immutable per-call snapshot fields.
 *   5. Parse the transcript into call_transcripts rows.
 *
 * Idempotency: (organisation_id, bolna_call_id) is unique on calls. Replays
 * upsert into the same row.
 */
export async function recordInboundCall(
  args: RecordInboundCallArgs,
): Promise<RecordInboundCallResult> {
  const admin = createAdminClient();
  const { payload, organisationId, externalId } = args;

  const fromPhone =
    payload.telephony_data?.from_number?.trim() ||
    payload.user_number?.trim() ||
    null;
  const toPhone = payload.telephony_data?.to_number?.trim() || null;
  const recordingUrl = payload.telephony_data?.recording_url ?? null;
  const transcript = payload.transcript ?? null;
  const durationSeconds =
    typeof payload.conversation_duration === "number"
      ? Math.round(payload.conversation_duration)
      : null;
  const agentId = payload.agent_id ?? "inbound";
  const startedAt =
    parseProviderTimestamp(payload.created_at) ?? new Date().toISOString();
  const endedAt = parseProviderTimestamp(payload.updated_at);
  const errorMessage = payload.error_message ?? null;
  const transcriptStatus: CallTranscriptStatus = transcript ? "ready" : "skipped";

  // Lead merge first — find-or-create + override-aware update + auto-discover.
  const merge = await mergePayloadIntoLead({
    organisationId,
    phoneRaw: fromPhone,
    payload,
    source: "inbound_call",
  });

  console.log("[inbound] recording call", {
    organisationId,
    leadId: merge.leadId,
    leadCreated: merge.created,
    externalId,
    fromPhone,
    toPhone,
    durationSeconds,
    hasTranscript: !!transcript,
    hasRecording: !!recordingUrl,
  });

  const { data: callRow, error: callErr } = await admin
    .from("calls")
    .upsert(
      {
        organisation_id: organisationId,
        lead_id: merge.leadId,
        bolna_call_id: externalId,
        direction: "inbound" as const,
        to_phone: toPhone,
        from_phone: fromPhone,
        agent_id: agentId,
        status: mapStatus(payload.status),
        call_outcome: args.callOutcome ?? null,
        requested_callback_at: args.requestedCallbackAt ?? null,
        duration_seconds: durationSeconds,
        recording_url: recordingUrl,
        transcript,
        transcript_status: transcriptStatus,
        transcript_fetched_at: transcript ? new Date().toISOString() : null,
        started_at: startedAt,
        ended_at: endedAt,
        error_message: errorMessage,
        summary: payload.summary ?? null,
        // Per-call snapshot columns — immutable record of this conversation.
        name_extracted: merge.callSnapshot.name_extracted,
        interest: merge.callSnapshot.interest,
        lead_intent_extracted: merge.callSnapshot.lead_intent_extracted,
        actionable: merge.callSnapshot.actionable,
        customer_status: merge.callSnapshot.customer_status,
        visit_scheduled_at: merge.callSnapshot.visit_scheduled_at,
        connect_on_whatsapp: merge.callSnapshot.connect_on_whatsapp,
        lead_data: merge.callSnapshot.lead_data,
        custom_data: merge.callSnapshot.custom_data,
      },
      { onConflict: "organisation_id,bolna_call_id" },
    )
    .select("id")
    .single<{ id: string }>();

  if (callErr) {
    console.error("[inbound] call upsert failed", callErr);
    return {
      callId: null,
      leadId: merge.leadId,
      transcriptStatus: "failed",
      leadCreated: merge.created,
    };
  }

  console.log("[inbound] call recorded", { callId: callRow.id });

  const finalStatus = await writeTranscriptTurns(
    callRow.id,
    organisationId,
    transcript,
  );
  return {
    callId: callRow.id,
    leadId: merge.leadId,
    transcriptStatus: finalStatus,
    leadCreated: merge.created,
  };
}

export async function writeTranscriptTurns(
  callId: string,
  organisationId: string,
  transcript: string | null,
): Promise<CallTranscriptStatus> {
  const admin = createAdminClient();
  if (!transcript) return "skipped";

  const turns = parseTranscript(transcript);
  if (turns.length === 0) {
    await admin
      .from("calls")
      .update({ transcript_status: "skipped" satisfies CallTranscriptStatus })
      .eq("id", callId);
    return "skipped";
  }

  await admin.from("call_transcripts").delete().eq("call_id", callId);

  const rows = turns.map((t) => ({
    call_id: callId,
    organisation_id: organisationId,
    seq: t.seq,
    speaker: t.speaker,
    text: t.text,
    started_ms: t.started_ms,
    ended_ms: t.ended_ms,
    confidence: t.confidence,
  }));

  const { error } = await admin.from("call_transcripts").insert(rows);
  if (error) {
    console.error("[inbound] transcript insert failed", error);
    await admin
      .from("calls")
      .update({ transcript_status: "failed" satisfies CallTranscriptStatus })
      .eq("id", callId);
    return "failed";
  }

  return "ready";
}
