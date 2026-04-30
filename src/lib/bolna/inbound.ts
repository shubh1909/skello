import "server-only";

import type { BolnaLeadPayload } from "@/lib/bolna/extract";
import { parseTranscript } from "@/lib/bolna/transcript";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CallStatus, CallTranscriptStatus } from "@/types/call";

interface RecordInboundCallArgs {
  organisationId: string;
  leadId: string;
  externalId: string;
  payload: BolnaLeadPayload;
}

interface RecordInboundCallResult {
  callId: string | null;
  transcriptStatus: CallTranscriptStatus;
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
 * Persist an inbound call directly from the post-call webhook payload.
 *
 * The webhook contains everything we need (transcript, recording, phones,
 * duration, agent id), so we don't have to round-trip Bolna's executions
 * API for this. The upsert is keyed on (organisation_id, bolna_call_id) so
 * webhook retries are idempotent.
 */
export async function recordInboundCall(
  args: RecordInboundCallArgs,
): Promise<RecordInboundCallResult> {
  const admin = createAdminClient();
  const { payload, organisationId, leadId, externalId } = args;

  const fromPhone = payload.telephony_data?.from_number?.trim() || null;
  const toPhone = payload.telephony_data?.to_number?.trim() || null;
  const recordingUrl = payload.telephony_data?.recording_url ?? null;
  const transcript = payload.transcript ?? null;
  const durationSeconds =
    typeof payload.conversation_duration === "number"
      ? Math.round(payload.conversation_duration)
      : null;
  const agentId = payload.agent_id ?? "inbound";
  const startedAt = payload.created_at ?? new Date().toISOString();
  const endedAt = payload.updated_at ?? null;
  const errorMessage = payload.error_message ?? null;
  const transcriptStatus: CallTranscriptStatus = transcript
    ? "ready"
    : "skipped";

  console.log("[inbound] recording call", {
    organisationId,
    leadId,
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
        lead_id: leadId,
        bolna_call_id: externalId,
        direction: "inbound" as const,
        to_phone: toPhone,
        from_phone: fromPhone,
        agent_id: agentId,
        status: mapStatus(payload.status),
        duration_seconds: durationSeconds,
        recording_url: recordingUrl,
        transcript,
        transcript_status: transcriptStatus,
        transcript_fetched_at: transcript ? new Date().toISOString() : null,
        started_at: startedAt,
        ended_at: endedAt,
        error_message: errorMessage,
      },
      { onConflict: "organisation_id,bolna_call_id" },
    )
    .select("id")
    .single<{ id: string }>();

  if (callErr) {
    console.error("[inbound] call upsert failed", callErr);
    return { callId: null, transcriptStatus: "failed" };
  }

  console.log("[inbound] call recorded", { callId: callRow.id });

  const finalStatus = await writeTranscriptTurns(
    callRow.id,
    organisationId,
    transcript,
  );
  return { callId: callRow.id, transcriptStatus: finalStatus };
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

  // Replace any prior turns so retries produce a clean set.
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
