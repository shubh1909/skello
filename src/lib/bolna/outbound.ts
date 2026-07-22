import "server-only";

import type { BolnaLeadPayload } from "@/lib/bolna/extract";
import { mapStatus, writeTranscriptTurns } from "@/lib/bolna/inbound";
import { mergePayloadIntoLead } from "@/lib/bolna/lead-merge";
import { applyScheduledCallbackOutcome } from "@/lib/callbacks/outcome";
import { applyCampaignContactOutcome } from "@/lib/campaigns/outcome";
import { applyShopifyRecoveryOutcome } from "@/lib/shopify/recovery";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveOrgByAgentId } from "@/lib/bolna/routing";
import { parseProviderTimestamp } from "@/lib/time";
import type { CallStatus, CallTranscriptStatus } from "@/types/call";

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
 * Update an outbound call from the post-call webhook payload.
 *
 * Post-remodel:
 *   - The call row was either created earlier by an outbound Server Action
 *     (with its lead_id already attached) OR it doesn't exist yet (direct
 *     dial from the provider's dashboard). For the second case we bootstrap.
 *   - Either way, we route through mergePayloadIntoLead so the lead's
 *     current view stays in sync with the LLM's extraction (override-aware),
 *     and the call snapshot captures the immutable per-conversation values.
 */
export async function recordOutboundResult(
  args: RecordOutboundResultArgs,
): Promise<RecordOutboundResultResult> {
  const admin = createAdminClient();
  const { payload, externalId } = args;

  // `bolna_call_id` is unique per-org, not globally. Fetch 2 so a cross-tenant
  // collision is detected instead of silently resolving to whichever row the
  // planner returned first.
  const { data: matches, error: findErr } = await admin
    .from("calls")
    .select("id, organisation_id, lead_id, is_test, campaign_contact_id, scheduled_callback_id, shopify_recovery_attempt_id")
    .eq("bolna_call_id", externalId)
    .limit(2)
    .returns<
      Array<{
        id: string;
        organisation_id: string;
        lead_id: string | null;
        is_test: boolean;
        campaign_contact_id: string | null;
        scheduled_callback_id: string | null;
        shopify_recovery_attempt_id: string | null;
      }>
    >();

  if (findErr) {
    console.error("[outbound] call lookup failed", findErr);
    return { callId: null, transcriptStatus: "failed", matchedExisting: false };
  }

  if (matches && matches.length > 1) {
    // Refuse rather than guess — merging one tenant's extraction into another
    // tenant's call and lead is worse than dropping the update.
    console.error(
      "[outbound] bolna_call_id matched calls in multiple organisations — update refused",
      { externalId, organisationIds: matches.map((m) => m.organisation_id) },
    );
    return { callId: null, transcriptStatus: "failed", matchedExisting: false };
  }

  const existingCall = matches?.[0] ?? null;

  let call = existingCall;
  const matchedExisting = !!existingCall;

  if (!call) {
    const bootstrapped = await bootstrapDirectOutboundCall(externalId, payload);
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
  const transcriptStatus: CallTranscriptStatus = transcript ? "ready" : "skipped";

  // Test calls (from Campaigns > Test Call) intentionally skip the lead
  // merge: a demo dial shouldn't create or update a real lead just because
  // the operator happened to type a phone that matches one. We still
  // capture the call outcome (status, transcript, recording, summary)
  // so the demo is replayable from Conversations.
  if (call.is_test) {
    console.log("[outbound] updating test call", {
      callId: call.id,
      externalId,
      status,
      durationSeconds,
      hasTranscript: !!transcript,
      hasRecording: !!recordingUrl,
    });
    const { error: testUpdateErr } = await admin
      .from("calls")
      .update({
        status,
        duration_seconds: durationSeconds,
        recording_url: recordingUrl,
        transcript,
        transcript_status: transcriptStatus,
        transcript_fetched_at: transcript ? new Date().toISOString() : null,
        // Provider timestamps are naive wall-clock in the app's zone, not UTC.
        // Parsing them raw silently shifts every value by the zone offset.
        ended_at: parseProviderTimestamp(payload.updated_at),
        error_message: payload.error_message ?? null,
        summary: payload.summary ?? null,
      })
      .eq("id", call.id);
    if (testUpdateErr) {
      console.error("[outbound] test call update failed", testUpdateErr);
      return {
        callId: call.id,
        transcriptStatus: "failed",
        matchedExisting,
      };
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

  // Run the merge — keeps the lead's current view + dynamic fields in sync.
  // Phone for outbound = `to_phone` on the existing call (we dialed it).
  const toPhone =
    payload.telephony_data?.to_number?.trim() ||
    payload.user_number?.trim() ||
    null;

  const merge = await mergePayloadIntoLead({
    organisationId: call.organisation_id,
    phoneRaw: toPhone,
    payload,
    source: "manual",
  });

  console.log("[outbound] updating call", {
    callId: call.id,
    externalId,
    status,
    durationSeconds,
    hasTranscript: !!transcript,
    hasRecording: !!recordingUrl,
    bootstrapped: !matchedExisting,
    leadId: merge.leadId,
  });

  // Patch the existing call row with the outcome + the per-call snapshot.
  // We also re-attach lead_id if it was missing (e.g. bootstrapped row).
  const { error: updateErr } = await admin
    .from("calls")
    .update({
      status,
      duration_seconds: durationSeconds,
      recording_url: recordingUrl,
      transcript,
      transcript_status: transcriptStatus,
      transcript_fetched_at: transcript ? new Date().toISOString() : null,
      // Naive wall-clock in the app's zone — see parseProviderTimestamp.
      ended_at: parseProviderTimestamp(payload.updated_at),
      error_message: payload.error_message ?? null,
      summary: payload.summary ?? null,
      lead_id: call.lead_id ?? merge.leadId,
      name_extracted: merge.callSnapshot.name_extracted,
      interest: merge.callSnapshot.interest,
      lead_intent_extracted: merge.callSnapshot.lead_intent_extracted,
      actionable: merge.callSnapshot.actionable,
      customer_status: merge.callSnapshot.customer_status,
      visit_scheduled_at: merge.callSnapshot.visit_scheduled_at,
      connect_on_whatsapp: merge.callSnapshot.connect_on_whatsapp,
      call_outcome: merge.callSnapshot.call_outcome,
      requested_callback_at: merge.callSnapshot.requested_callback_at,
      lead_data: merge.callSnapshot.lead_data,
      custom_data: merge.callSnapshot.custom_data,
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

  const finalStatus = await writeTranscriptTurns(
    call.id,
    call.organisation_id,
    transcript,
  );

  // Advance the campaign state machine with the customer's disposition. This is
  // the ONLY place a `completed` campaign contact is finalised — the disposition
  // (call_outcome) lives only in the extracted payload, so the status-only
  // webhook path defers `completed` to here. Best-effort: a failure must not
  // break the call-record response (the in-flight reconcile is the backstop).
  if (call.campaign_contact_id) {
    try {
      await applyCampaignContactOutcome({
        contactId: call.campaign_contact_id,
        callId: call.id,
        callStatus: status,
        callOutcome: merge.callSnapshot.call_outcome,
        requestedCallbackAt: merge.callSnapshot.requested_callback_at,
      });
    } catch (err) {
      console.error("[outbound] campaign outcome failed", err);
    }
  }

  // Finalise a scheduled callback's own dial when it `completed` (same reason as
  // campaigns: reaching the customer is only known on the extracted event).
  if (call.scheduled_callback_id) {
    try {
      await applyScheduledCallbackOutcome({
        callbackId: call.scheduled_callback_id,
        callId: call.id,
        callStatus: status,
        callOutcome: merge.callSnapshot.call_outcome,
      });
    } catch (err) {
      console.error("[outbound] callback outcome failed", err);
    }
  }

  // Finalise a cart-recovery dial when it `completed` — reaching the shopper
  // ends the attempt (the conversion itself is tracked from the order webhook).
  if (call.shopify_recovery_attempt_id) {
    try {
      await applyShopifyRecoveryOutcome({
        attemptId: call.shopify_recovery_attempt_id,
        callId: call.id,
        callStatus: status,
      });
    } catch (err) {
      console.error("[outbound] recovery outcome failed", err);
    }
  }

  return {
    callId: call.id,
    transcriptStatus: finalStatus,
    matchedExisting,
  };
}

// Bootstrap a calls row for direct-from-provider dials. Resolves org via
// agent_id (no more `or(agent_id.eq.X,agent_ids.cs.{X})` hack — voice_agents
// is the single source of truth now).
async function bootstrapDirectOutboundCall(
  externalId: string,
  payload: BolnaLeadPayload,
): Promise<{
  id: string;
  organisation_id: string;
  lead_id: string | null;
  is_test: boolean;
  campaign_contact_id: string | null;
  scheduled_callback_id: string | null;
  shopify_recovery_attempt_id: string | null;
} | null> {
  const agentId = payload.agent_id?.trim();
  if (!agentId) return null;

  const route = await resolveOrgByAgentId(agentId);
  if (!route) return null;

  const admin = createAdminClient();
  const toPhone =
    payload.telephony_data?.to_number?.trim() ||
    payload.user_number?.trim() ||
    null;
  const fromPhone =
    payload.telephony_data?.from_number?.trim() ||
    payload.agent_number?.trim() ||
    null;
  // Naive wall-clock in the app's zone — see parseProviderTimestamp.
  const startedAt = parseProviderTimestamp(
    payload.initiated_at ?? payload.created_at,
  );

  const { data: inserted, error: insertErr } = await admin
    .from("calls")
    .insert({
      organisation_id: route.organisationId,
      bolna_call_id: externalId,
      agent_id: agentId,
      direction: "outbound",
      to_phone: toPhone,
      from_phone: fromPhone,
      status: "initiated",
      ...(startedAt ? { started_at: startedAt } : {}),
    })
    .select("id, organisation_id, lead_id, is_test, campaign_contact_id, scheduled_callback_id, shopify_recovery_attempt_id")
    .single<{
      id: string;
      organisation_id: string;
      lead_id: string | null;
      is_test: boolean;
      campaign_contact_id: string | null;
      scheduled_callback_id: string | null;
      shopify_recovery_attempt_id: string | null;
    }>();

  if (!insertErr && inserted) return inserted;

  // Lost the race against a sibling delivery — refetch.
  if (insertErr?.code === "23505") {
    const { data: refetched } = await admin
      .from("calls")
      .select("id, organisation_id, lead_id, is_test, campaign_contact_id, scheduled_callback_id, shopify_recovery_attempt_id")
      .eq("organisation_id", route.organisationId)
      .eq("bolna_call_id", externalId)
      .maybeSingle<{
        id: string;
        organisation_id: string;
        lead_id: string | null;
        is_test: boolean;
        campaign_contact_id: string | null;
        scheduled_callback_id: string | null;
        shopify_recovery_attempt_id: string | null;
      }>();
    if (refetched) return refetched;
  }

  console.error("[outbound] bootstrap insert failed", insertErr);
  return null;
}
