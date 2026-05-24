"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth/session";
import { writeTranscriptTurns } from "@/lib/bolna/inbound";
import { mergePayloadIntoLead } from "@/lib/bolna/lead-merge";
import { resolveOrgByAgentId } from "@/lib/bolna/routing";
import { buildSummary, type BolnaLeadPayload } from "@/lib/bolna/extract";
import { logSkeloError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  type BolnaCsvRow,
  importChunkInputSchema,
} from "@/lib/validations/bolna-csv";
import { type ActionResult, fail, ok } from "@/types/action";
import type { CallStatus, CallTranscriptStatus } from "@/types/call";

export type ImportRowOutcome = "imported" | "deduped" | "error";

export type ImportRowResult =
  | { id: string; outcome: "imported"; callId: string; leadLinked: boolean }
  | { id: string; outcome: "deduped"; callId: string }
  | { id: string; outcome: "error"; error: string };

export interface ImportChunkResponse {
  results: ImportRowResult[];
}

// Mirrors the SQL expression on leads.phone_normalized so the lookup matches
// the generated column exactly.
function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  return digits.length === 0 ? null : digits;
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

function mapStatus(raw: string | null | undefined): CallStatus {
  if (!raw) return "completed";
  return STATUS_MAP[raw.toLowerCase()] ?? "completed";
}

// Reconstruct a BolnaLeadPayload from the validated CSV row so we can reuse
// the existing lead-merge pipeline. The CSV doesn't carry the provider-side
// `summary` field — we synthesise one from the per-field reasoning blobs
// (same way the post-call webhook does).
function csvRowToPayload(row: BolnaCsvRow): BolnaLeadPayload {
  const hasExtracted = Object.keys(row.lead_data).length > 0;
  return {
    extracted_data: hasExtracted
      ? { lead_data: row.lead_data as never }
      : null,
    status: row.status ?? undefined,
    user_number: row.user_number ?? undefined,
    agent_number: row.agent_number ?? undefined,
    transcript: row.transcript ?? undefined,
    agent_id: row.agent_id,
    conversation_duration: row.duration ?? undefined,
    created_at: row.created_at ?? undefined,
    initiated_at: row.created_at ?? undefined,
    total_cost: row.total_cost ?? undefined,
    telephony_data: {
      to_number: row.user_number ?? undefined,
      from_number: row.agent_number ?? undefined,
      recording_url: row.recording_url ?? undefined,
      call_type: "outbound",
    },
  } as BolnaLeadPayload;
}

async function processRow(
  row: BolnaCsvRow,
  sessionOrgId: string,
): Promise<ImportRowResult> {
  // Tenant safety: the agent_id must map back to the caller's workspace.
  // voice_agents enforces one org per agent_id, so this is also our cross-
  // tenant guard for the calls insert below.
  const route = await resolveOrgByAgentId(row.agent_id);
  if (!route) {
    return {
      id: row.id,
      outcome: "error",
      error: `Agent ${row.agent_id} is not registered. Add it under Voice Agents first.`,
    };
  }
  if (route.organisationId !== sessionOrgId) {
    return {
      id: row.id,
      outcome: "error",
      error: `Agent ${row.agent_id} belongs to a different workspace.`,
    };
  }

  const admin = createAdminClient();

  // Idempotency check, explicitly scoped to the session org. The unique
  // constraint on (organisation_id, bolna_call_id) backstops this — see the
  // 23505 branch on the insert below.
  const { data: existing } = await admin
    .from("calls")
    .select("id")
    .eq("organisation_id", sessionOrgId)
    .eq("bolna_call_id", row.id)
    .maybeSingle<{ id: string }>();
  if (existing) {
    return { id: row.id, outcome: "deduped", callId: existing.id };
  }

  const payload = csvRowToPayload(row);
  const hasExtracted = !!payload.extracted_data;

  // Two paths diverge on whether the row has extracted_data.
  //   - With extracted_data: full merge via mergePayloadIntoLead — find-or-
  //     create the lead by phone, merge override-aware, auto-register fields.
  //   - Without extracted_data (e.g. status=Unknown rows in the Bolna export):
  //     only link to an existing lead by phone, don't create one. We still
  //     bootstrap the call row so the user's full call history is preserved.
  let leadId: string | null = null;
  let snapshot: Awaited<
    ReturnType<typeof mergePayloadIntoLead>
  >["callSnapshot"] | null = null;

  if (hasExtracted) {
    const merged = await mergePayloadIntoLead({
      organisationId: sessionOrgId,
      phoneRaw: row.user_number ?? null,
      payload,
      source: "manual",
    });
    leadId = merged.leadId;
    snapshot = merged.callSnapshot;
  } else {
    const phoneNorm = normalizePhone(row.user_number ?? null);
    if (phoneNorm) {
      const { data: lead } = await admin
        .from("leads")
        .select("id")
        .eq("organisation_id", sessionOrgId)
        .eq("phone_normalized", phoneNorm)
        .maybeSingle<{ id: string }>();
      leadId = lead?.id ?? null;
    }
  }

  const transcript = row.transcript ?? null;
  const summaryFromLeadData =
    payload.extracted_data?.lead_data
      ? buildSummary(payload.extracted_data.lead_data)
      : null;

  const baseInsert = {
    organisation_id: sessionOrgId,
    lead_id: leadId,
    bolna_call_id: row.id,
    agent_id: row.agent_id,
    direction: "outbound" as const,
    to_phone: row.user_number ?? null,
    from_phone: row.agent_number ?? null,
    status: mapStatus(row.status),
    duration_seconds:
      typeof row.duration === "number" ? Math.round(row.duration) : null,
    recording_url: row.recording_url ?? null,
    transcript,
    transcript_status: (transcript
      ? "ready"
      : "skipped") satisfies CallTranscriptStatus,
    transcript_fetched_at: transcript ? new Date().toISOString() : null,
    started_at: row.created_at ?? null,
    ended_at: null,
    error_message: null,
    summary: summaryFromLeadData,
  };

  const snapshotFields = snapshot
    ? {
        name_extracted: snapshot.name_extracted,
        interest: snapshot.interest,
        lead_intent_extracted: snapshot.lead_intent_extracted,
        actionable: snapshot.actionable,
        customer_status: snapshot.customer_status,
        visit_scheduled_at: snapshot.visit_scheduled_at,
        connect_on_whatsapp: snapshot.connect_on_whatsapp,
        lead_data: snapshot.lead_data,
        custom_data: snapshot.custom_data,
      }
    : {};

  const { data: inserted, error: insertErr } = await admin
    .from("calls")
    .insert({ ...baseInsert, ...snapshotFields })
    .select("id")
    .single<{ id: string }>();

  if (insertErr) {
    // Lost the race against another caller importing the same row (or the
    // dedupe SELECT was stale). Refetch by the unique key and treat as
    // deduped — safer than failing the whole row.
    if (insertErr.code === "23505") {
      const { data: raced } = await admin
        .from("calls")
        .select("id")
        .eq("organisation_id", sessionOrgId)
        .eq("bolna_call_id", row.id)
        .maybeSingle<{ id: string }>();
      if (raced) {
        return { id: row.id, outcome: "deduped", callId: raced.id };
      }
    }
    return {
      id: row.id,
      outcome: "error",
      error: logSkeloError("WEBHOOK-INGEST", "CSV-import call insert failed", {
        organisationId: sessionOrgId,
        bolnaCallId: row.id,
        cause: insertErr,
      }),
    };
  }

  if (transcript) {
    await writeTranscriptTurns(inserted.id, sessionOrgId, transcript);
  }

  return {
    id: row.id,
    outcome: "imported",
    callId: inserted.id,
    leadLinked: leadId !== null,
  };
}

export async function importBolnaCallsChunk(
  input: unknown,
): Promise<ActionResult<ImportChunkResponse>> {
  const parsed = importChunkInputSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  // requireSession() only returns the org where owner_id = auth.uid(), so
  // by the time we have a session we already know the user owns this org.
  const session = await requireSession();
  const sessionOrgId = session.organisation.id;

  // Sequential per-row processing keeps DB load predictable and avoids
  // races on the same bolna_call_id within a chunk. The browser parallelises
  // across chunks if it wants to; for v1 we ship chunks sequentially.
  const results: ImportRowResult[] = [];
  for (const row of parsed.data.rows) {
    try {
      results.push(await processRow(row, sessionOrgId));
    } catch (err) {
      results.push({
        id: row.id,
        outcome: "error",
        error:
          err instanceof Error ? err.message : "Unexpected error processing row",
      });
    }
  }

  // Revalidate any view that surfaces aggregated call data. We don't know
  // which leads were touched, so we invalidate the leads index broadly.
  revalidatePath("/leads");
  revalidatePath("/dashboard");

  return ok({ results });
}
