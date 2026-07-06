import "server-only";

import {
  BolnaApiError,
  type ExecutionPayload,
  fetchBolnaExecution,
} from "@/lib/bolna/client";
import { parseTranscript } from "@/lib/bolna/transcript";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseProviderTimestamp } from "@/lib/time";

type Admin = ReturnType<typeof createAdminClient>;

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

interface EnrichInboundArgs {
  organisationId: string;
  leadId: string;
  orgSlug: string;
  executionId: string;
}

interface EnrichInboundResult {
  phone: string | null;
  callId: string | null;
  transcriptStatus: "ready" | "skipped" | "failed";
}

/**
 * Inbound path: lead already exists; look up telephony_data to fill the
 * caller's phone, then create or upsert the call row and its transcript turns.
 * Never throws — partial data is better than dropping the lead.
 */
export async function enrichInboundLead(
  args: EnrichInboundArgs,
): Promise<EnrichInboundResult> {
  const admin = createAdminClient();
  const result: EnrichInboundResult = {
    phone: null,
    callId: null,
    transcriptStatus: "skipped",
  };

  const apiKey = await resolveApiKey(admin, args.organisationId);
  if (!apiKey) {
    console.warn("[enrich] no api key for org", args.organisationId);
    return result;
  }

  const execution = await fetchWithRetry(apiKey, args.executionId);
  if (!execution) return result;

  // For inbound calls, `from_number` is the caller (the lead) and `to_number`
  // is our voice-agent line. The lead row stores the caller's number; the
  // call row keeps both sides so the UI can render direction correctly.
  const callerPhone = execution.telephony_data?.from_number?.trim() || null;
  const agentPhone = execution.telephony_data?.to_number?.trim() || null;
  if (callerPhone) {
    const { error } = await admin
      .from("leads")
      .update({ phone: callerPhone })
      .eq("id", args.leadId);
    if (error) console.error("[enrich] phone update failed", error);
    else result.phone = callerPhone;
  }

  const { data: callRow, error: callErr } = await admin
    .from("calls")
    .upsert(
      {
        organisation_id: args.organisationId,
        lead_id: args.leadId,
        bolna_call_id: args.executionId,
        direction: "inbound" as const,
        to_phone: agentPhone,
        from_phone: callerPhone,
        agent_id: "inbound",
        status: mapExecutionStatus(execution.status),
        duration_seconds:
          typeof execution.conversation_time === "number"
            ? Math.round(execution.conversation_time)
            : null,
        started_at:
          parseProviderTimestamp(execution.created_at) ??
          new Date().toISOString(),
        ended_at: parseProviderTimestamp(execution.updated_at),
        error_message: execution.error_message ?? null,
      },
      { onConflict: "organisation_id,bolna_call_id" },
    )
    .select("id")
    .single<{ id: string }>();

  if (callErr) {
    console.error("[enrich] call upsert failed", callErr);
    return result;
  }
  result.callId = callRow.id;
  result.transcriptStatus = await writeTranscript(
    admin,
    callRow.id,
    args.organisationId,
    execution,
  );
  return result;
}

interface EnrichOutboundArgs {
  organisationId: string;
  callId: string;
  executionId: string;
}

/**
 * Outbound path: the call row already exists (created by initiateCall). We
 * fetch the execution, populate timing + transcript, and store parsed turns.
 */
export async function enrichOutboundCall(
  args: EnrichOutboundArgs,
): Promise<"ready" | "skipped" | "failed"> {
  const admin = createAdminClient();
  const apiKey = await resolveApiKey(admin, args.organisationId);
  if (!apiKey) return "skipped";

  const execution = await fetchWithRetry(apiKey, args.executionId);
  if (!execution) return "failed";

  const patch: Record<string, unknown> = {};
  if (typeof execution.conversation_time === "number") {
    patch.duration_seconds = Math.round(execution.conversation_time);
  }
  const endedAt = parseProviderTimestamp(execution.updated_at);
  if (endedAt) patch.ended_at = endedAt;
  if (execution.error_message) patch.error_message = execution.error_message;
  // For outbound, `from_number` is the caller-ID we dialled from. Persist it —
  // dispatch may have inserted the row without one (the number lives on the
  // provider's agent config), so this is often the only place we learn it.
  const fromNumber = execution.telephony_data?.from_number?.trim() || null;
  if (fromNumber) patch.from_phone = fromNumber;
  if (Object.keys(patch).length > 0) {
    const { error } = await admin
      .from("calls")
      .update(patch)
      .eq("id", args.callId);
    if (error) console.error("[enrich] outbound call update failed", error);
  }

  return writeTranscript(
    admin,
    args.callId,
    args.organisationId,
    execution,
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function writeTranscript(
  admin: Admin,
  callId: string,
  organisationId: string,
  execution: ExecutionPayload,
): Promise<"ready" | "skipped" | "failed"> {
  // Mark processing + stash the raw blob first so we never lose it even if
  // the turn-parse path later fails.
  const { error: preErr } = await admin
    .from("calls")
    .update({
      transcript: execution.transcript ?? null,
      transcript_status: "processing" as const,
      transcript_fetched_at: new Date().toISOString(),
    })
    .eq("id", callId);
  if (preErr) {
    console.error("[enrich] transcript pre-update failed", preErr);
    return "failed";
  }

  const turns = parseTranscript(execution.transcript);
  if (turns.length === 0) {
    await admin
      .from("calls")
      .update({ transcript_status: "skipped" })
      .eq("id", callId);
    return "skipped";
  }

  // Replace any existing turns so re-enrichment produces a clean set.
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
  const { error: turnsErr } = await admin.from("call_transcripts").insert(rows);
  if (turnsErr) {
    console.error("[enrich] turns insert failed", turnsErr);
    await admin
      .from("calls")
      .update({ transcript_status: "failed" })
      .eq("id", callId);
    return "failed";
  }

  await admin
    .from("calls")
    .update({ transcript_status: "ready" })
    .eq("id", callId);
  return "ready";
}

async function resolveApiKey(
  admin: Admin,
  organisationId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("bolna_integrations")
    .select("api_key, enabled")
    .eq("organisation_id", organisationId)
    .maybeSingle<{ api_key: string; enabled: boolean }>();
  if (!data || !data.enabled) return null;
  return data.api_key;
}

async function fetchWithRetry(
  apiKey: string,
  executionId: string,
): Promise<ExecutionPayload | null> {
  const delays = [0, 800, 2000];
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) {
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
    try {
      const execution = await fetchBolnaExecution({ apiKey, executionId });
      if (execution.transcript || execution.telephony_data) return execution;
    } catch (err) {
      const is4xx =
        err instanceof BolnaApiError && err.status >= 400 && err.status < 500;
      if (is4xx && attempt === delays.length - 1) {
        console.warn("[enrich] execution fetch gave up", executionId, err);
        return null;
      }
      if (!is4xx) console.warn("[enrich] execution fetch errored", err);
    }
  }
  return null;
}

function mapExecutionStatus(raw: string | undefined): string {
  if (!raw) return "completed";
  const map: Record<string, string> = {
    completed: "completed",
    ended: "completed",
    failed: "failed",
    "no-answer": "no_answer",
    no_answer: "no_answer",
    busy: "busy",
    canceled: "canceled",
    cancelled: "canceled",
  };
  return map[raw.toLowerCase()] ?? "completed";
}
