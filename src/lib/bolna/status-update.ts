import "server-only";

import { after } from "next/server";

import { enrichOutboundCall } from "@/lib/bolna/enrich";
import { applyCampaignContactOutcome } from "@/lib/campaigns/outcome";
import { logSkeloError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CallStatus } from "@/types/call";

// Bolna emits a variety of status strings across the call lifecycle. We
// collapse provider-internal states (scheduled / rescheduled / queued) into
// our canonical CallStatus values so the UI doesn't need to know about
// provider quirks. Unknown strings return null — the caller decides whether
// that's a 400 (strict /calls endpoint) or a silent ack (lenient /leads
// endpoint receiving an unrelated event).
const STATUS_MAP: Record<string, CallStatus> = {
  initiated: "initiated",
  queued: "initiated",
  scheduled: "initiated",
  rescheduled: "initiated",
  ringing: "ringing",
  answered: "in_progress",
  "in-progress": "in_progress",
  in_progress: "in_progress",
  completed: "completed",
  ended: "completed",
  "call-disconnected": "completed",
  failed: "failed",
  "no-answer": "no_answer",
  no_answer: "no_answer",
  busy: "busy",
  canceled: "canceled",
  cancelled: "canceled",
};

export function mapBolnaStatus(
  raw: string | null | undefined,
): CallStatus | null {
  if (!raw) return null;
  return STATUS_MAP[raw.trim().toLowerCase()] ?? null;
}

export interface StatusUpdateInput {
  bolnaCallId: string;
  status: CallStatus;
  answeredAt?: string | null;
  endedAt?: string | null;
  durationSeconds?: number | null;
  recordingUrl?: string | null;
  transcriptUrl?: string | null;
  summary?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export type StatusUpdateResult =
  | {
      kind: "updated";
      callId: string;
      organisationId: string;
      campaignContactId: string | null;
    }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

/**
 * Apply a Bolna call-status update to the matching `calls` row, then
 * schedule the two side-effects we used to run only from the dedicated
 * /calls webhook:
 *
 *   - On `completed`: fetch the full execution from Bolna's REST API and
 *     store the parsed transcript turns (retries with backoff if the
 *     transcript isn't ready yet).
 *   - If the call belongs to a campaign contact: advance the campaign
 *     state machine (succeeded / re-armed / failed).
 *
 * Both side-effects run via `after()` so the webhook response stays fast.
 *
 * Caller decides what to do with `not_found`:
 *   - /calls endpoint: treat as 404 (loud — config issue).
 *   - /leads pre-extraction path: treat as silent 200 (inbound calls land
 *     before the `calls` row is created, expected).
 */
export async function applyCallStatusUpdate(
  input: StatusUpdateInput,
): Promise<StatusUpdateResult> {
  const admin = createAdminClient();

  const patch: Record<string, unknown> = { status: input.status };
  if (input.answeredAt) patch.answered_at = input.answeredAt;
  if (input.endedAt) patch.ended_at = input.endedAt;
  if (typeof input.durationSeconds === "number") {
    patch.duration_seconds = input.durationSeconds;
  }
  if (input.recordingUrl) patch.recording_url = input.recordingUrl;
  if (input.transcriptUrl) patch.transcript_url = input.transcriptUrl;
  if (input.summary) patch.summary = input.summary;
  if (input.errorCode) patch.error_code = input.errorCode;
  if (input.errorMessage) patch.error_message = input.errorMessage;

  const { data, error } = await admin
    .from("calls")
    .update(patch)
    .eq("bolna_call_id", input.bolnaCallId)
    .select("id, organisation_id, campaign_contact_id")
    .maybeSingle<{
      id: string;
      organisation_id: string;
      campaign_contact_id: string | null;
    }>();

  if (error) {
    const message = logSkeloError(
      "WEBHOOK-INGEST",
      "Call status update failed",
      { bolnaCallId: input.bolnaCallId, cause: error },
    );
    return { kind: "error", message };
  }

  if (!data) {
    return { kind: "not_found" };
  }

  // Defer the heavy work — keeps the webhook snappy even if Bolna retries
  // aggressively. Both branches are best-effort: a thrown error here only
  // shows up in server logs, never in the webhook response.
  if (input.status === "completed") {
    const callId = data.id;
    const orgId = data.organisation_id;
    const executionId = input.bolnaCallId;
    after(async () => {
      try {
        await enrichOutboundCall({
          organisationId: orgId,
          callId,
          executionId,
        });
      } catch (err) {
        console.error("[status-update] enrichment failed", err);
      }
    });
  }

  if (data.campaign_contact_id) {
    const contactId = data.campaign_contact_id;
    const callId = data.id;
    const status = input.status;
    after(async () => {
      try {
        await applyCampaignContactOutcome({
          contactId,
          callId,
          callStatus: status,
        });
      } catch (err) {
        console.error("[status-update] campaign outcome failed", err);
      }
    });
  }

  return {
    kind: "updated",
    callId: data.id,
    organisationId: data.organisation_id,
    campaignContactId: data.campaign_contact_id,
  };
}
