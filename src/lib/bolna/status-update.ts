import "server-only";

import { after } from "next/server";

import { enrichOutboundCall } from "@/lib/bolna/enrich";
import { applyScheduledCallbackOutcome } from "@/lib/callbacks/outcome";
import { applyCampaignContactOutcome } from "@/lib/campaigns/outcome";
import { applyShopifyRecoveryOutcome } from "@/lib/shopify/recovery";
import { logSkeloError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseProviderTimestamp } from "@/lib/time";
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
  // Provider timestamps may arrive without a timezone; interpret them in the
  // app's zone rather than the server's so stored instants aren't shifted.
  const answeredAt = parseProviderTimestamp(input.answeredAt);
  const endedAt = parseProviderTimestamp(input.endedAt);
  if (answeredAt) patch.answered_at = answeredAt;
  if (endedAt) patch.ended_at = endedAt;
  if (typeof input.durationSeconds === "number") {
    patch.duration_seconds = input.durationSeconds;
  }
  if (input.recordingUrl) patch.recording_url = input.recordingUrl;
  if (input.transcriptUrl) patch.transcript_url = input.transcriptUrl;
  if (input.summary) patch.summary = input.summary;
  if (input.errorCode) patch.error_code = input.errorCode;
  if (input.errorMessage) patch.error_message = input.errorMessage;

  // Resolve the target row BEFORE mutating. `bolna_call_id` is only unique
  // per-org, so a bare `.update().eq("bolna_call_id", …)` would write across
  // every tenant holding that id — the error surfaces only afterwards, once
  // the damage is done. Fetch 2 to detect ambiguity, then update by primary
  // key so exactly one row can ever be touched.
  const { data: candidates, error: lookupError } = await admin
    .from("calls")
    .select("id, organisation_id")
    .eq("bolna_call_id", input.bolnaCallId)
    .limit(2)
    .returns<Array<{ id: string; organisation_id: string }>>();

  if (lookupError) {
    const message = logSkeloError(
      "WEBHOOK-INGEST",
      "Call status update failed",
      { bolnaCallId: input.bolnaCallId, cause: lookupError },
    );
    return { kind: "error", message };
  }

  if (!candidates || candidates.length === 0) {
    return { kind: "not_found" };
  }

  if (candidates.length > 1) {
    // Cross-tenant id collision. Refuse rather than guess — picking either row
    // corrupts one tenant's call log with another's outcome.
    const message = logSkeloError(
      "WEBHOOK-INGEST",
      "Call status update failed",
      {
        bolnaCallId: input.bolnaCallId,
        cause: new Error(
          "bolna_call_id matched calls in multiple organisations — update refused",
        ),
      },
    );
    return { kind: "error", message };
  }

  const { data, error } = await admin
    .from("calls")
    .update(patch)
    .eq("id", candidates[0].id)
    .select(
      "id, organisation_id, campaign_contact_id, scheduled_callback_id, shopify_recovery_attempt_id",
    )
    .maybeSingle<{
      id: string;
      organisation_id: string;
      campaign_contact_id: string | null;
      scheduled_callback_id: string | null;
      shopify_recovery_attempt_id: string | null;
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

  // Advance the campaign state machine for TECHNICAL terminal statuses only
  // (no_answer / busy / failed / canceled). A `completed` call's fate depends
  // on the customer's disposition (call_outcome), which only arrives on the
  // final extracted_data webhook — recordOutboundResult() owns that transition.
  // Finalising `completed` here would race ahead of the disposition and could
  // mark a "do not call" contact as succeeded. If the extracted event never
  // lands, the 30-min in-flight reconcile sweeps the contact to failed.
  if (data.campaign_contact_id && input.status !== "completed") {
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

  // Same split for a scheduled callback's own dial: technical terminal statuses
  // (no_answer / busy / failed / canceled) resolve here; a `completed` callback
  // is finalised by recordOutboundResult on the extracted event.
  if (data.scheduled_callback_id && input.status !== "completed") {
    const callbackId = data.scheduled_callback_id;
    const callId = data.id;
    const status = input.status;
    after(async () => {
      try {
        await applyScheduledCallbackOutcome({
          callbackId,
          callId,
          callStatus: status,
        });
      } catch (err) {
        console.error("[status-update] callback outcome failed", err);
      }
    });
  }

  // Same split for a cart-recovery dial: technical terminal statuses resolve
  // here; a `completed` recovery is finalised by recordOutboundResult.
  if (data.shopify_recovery_attempt_id && input.status !== "completed") {
    const attemptId = data.shopify_recovery_attempt_id;
    const callId = data.id;
    const status = input.status;
    after(async () => {
      try {
        await applyShopifyRecoveryOutcome({
          attemptId,
          callId,
          callStatus: status,
        });
      } catch (err) {
        console.error("[status-update] recovery outcome failed", err);
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
