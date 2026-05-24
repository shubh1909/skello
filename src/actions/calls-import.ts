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

export type ImportRowOutcome = "imported" | "updated" | "error";

export type ImportRowResult =
  | { id: string; outcome: "imported"; callId: string; leadLinked: boolean }
  | { id: string; outcome: "updated"; callId: string; leadLinked: boolean }
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

  // Pre-check: does a call with this (org, bolna_call_id) already exist? We
  // do NOT early-return on a match — pre-existing calls (e.g. created by the
  // Bolna webhook with empty extracted_data) need the CSV's snapshot patched
  // in. The pre-check is purely for reporting "imported" vs "updated".
  const { data: existing } = await admin
    .from("calls")
    .select("id, lead_id")
    .eq("organisation_id", sessionOrgId)
    .eq("bolna_call_id", row.id)
    .maybeSingle<{ id: string; lead_id: string | null }>();

  const payload = csvRowToPayload(row);
  const hasExtracted = !!payload.extracted_data;

  // Two paths diverge on whether the row has extracted_data.
  //   - With extracted_data: full merge via mergePayloadIntoLead — find-or-
  //     create the lead by phone, merge override-aware, auto-register fields.
  //   - Without extracted_data: only link to an existing lead by phone, don't
  //     create one. We still write the call row so the call history is intact.
  let leadId: string | null = existing?.lead_id ?? null;
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
    // Prefer the existing lead_id if the call row was already linked, so a
    // manual relink via the UI isn't clobbered by the phone-based lookup.
    leadId = existing?.lead_id ?? merged.leadId;
    snapshot = merged.callSnapshot;
  } else if (!leadId) {
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

  // Fields written on BOTH insert and update — i.e., the per-call data
  // sourced from the CSV. We deliberately omit `bolna_call_id`, `direction`,
  // `agent_id`, and `created_at` from the update path: those are immutable
  // identifiers / set on insert.
  const writableFields = {
    lead_id: leadId,
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
    summary: summaryFromLeadData,
    ...(snapshot
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
      : {}),
  };

  let callId: string;
  if (existing) {
    const { error: updateErr } = await admin
      .from("calls")
      .update(writableFields)
      .eq("id", existing.id);
    if (updateErr) {
      return {
        id: row.id,
        outcome: "error",
        error: logSkeloError("WEBHOOK-INGEST", "CSV-import call update failed", {
          organisationId: sessionOrgId,
          bolnaCallId: row.id,
          callId: existing.id,
          cause: updateErr,
        }),
      };
    }
    callId = existing.id;
  } else {
    const { data: inserted, error: insertErr } = await admin
      .from("calls")
      .insert({
        organisation_id: sessionOrgId,
        bolna_call_id: row.id,
        agent_id: row.agent_id,
        direction: "outbound" as const,
        ended_at: null,
        error_message: null,
        ...writableFields,
      })
      .select("id")
      .single<{ id: string }>();

    if (insertErr) {
      // Lost the race against a concurrent import — the unique constraint
      // fires. Refetch and fall through to the update branch logic.
      if (insertErr.code === "23505") {
        const { data: raced } = await admin
          .from("calls")
          .select("id")
          .eq("organisation_id", sessionOrgId)
          .eq("bolna_call_id", row.id)
          .maybeSingle<{ id: string }>();
        if (raced) {
          const { error: updateErr } = await admin
            .from("calls")
            .update(writableFields)
            .eq("id", raced.id);
          if (updateErr) {
            return {
              id: row.id,
              outcome: "error",
              error: logSkeloError(
                "WEBHOOK-INGEST",
                "CSV-import race-recovery update failed",
                {
                  organisationId: sessionOrgId,
                  bolnaCallId: row.id,
                  cause: updateErr,
                },
              ),
            };
          }
          if (transcript) {
            await writeTranscriptTurns(raced.id, sessionOrgId, transcript);
          }
          return {
            id: row.id,
            outcome: "updated",
            callId: raced.id,
            leadLinked: leadId !== null,
          };
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
    callId = inserted.id;
  }

  if (transcript) {
    await writeTranscriptTurns(callId, sessionOrgId, transcript);
  }

  return {
    id: row.id,
    outcome: existing ? "updated" : "imported",
    callId,
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
