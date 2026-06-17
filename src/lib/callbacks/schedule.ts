import "server-only";

import { callbackTime } from "@/lib/campaigns/outcome-decision";
import { loadOutcomePolicy } from "@/lib/campaigns/outcome";
import { warnSkelo } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CallOutcome } from "@/types/call";
import { FALLBACK_OUTCOME_KEY } from "@/types/outcome-policy";

// Standard retry cadence for a freshly-queued callback row. The DB column has
// the same default; we pass it explicitly so callbackTime() can fall back to it
// when the customer gave no concrete time.
const DEFAULT_RETRY_INTERVAL_SECONDS = 900;

interface MaybeScheduleInput {
  organisationId: string;
  // The inbound call that triggered this. Required: it's both the provenance
  // link and the idempotency key (3x webhook retries → one callback).
  sourceCallId: string | null;
  leadId: string | null;
  phone: string | null; // the inbound caller's number = who we call back
  callOutcome: CallOutcome | null;
  requestedCallbackAt: string | null;
}

type ScheduleResult =
  | { scheduled: true; callbackId: string }
  | { scheduled: false; reason: string };

interface CallbackConfigRow {
  agent_id: string;
  from_phone_number: string | null;
  enabled: boolean;
  callbacks_enabled: boolean;
  callback_agent_id: string | null;
  callback_from_phone: string | null;
}

/**
 * Decide whether an inbound call should spawn an automated callback, and queue
 * it if so. Called from the inbound webhook AFTER the call + lead are recorded.
 *
 * The "should we" decision reuses the org's outcome policy — the SAME mapping
 * that drives campaign callbacks — so an outcome configured as `callback`
 * behaves identically whether it came from a campaign dial or an inbound call.
 *
 * Never throws: a failure here must not break the webhook's 200. The unique
 * index on source_call_id makes the insert idempotent across retries.
 */
export async function maybeScheduleInboundCallback(
  input: MaybeScheduleInput,
): Promise<ScheduleResult> {
  const { organisationId, sourceCallId, leadId, phone, callOutcome } = input;

  // Need a call to attribute to (idempotency key) and a number to dial back.
  if (!sourceCallId) return { scheduled: false, reason: "no_source_call" };
  const dialPhone = phone?.trim() ?? "";
  if (dialPhone.length < 5) return { scheduled: false, reason: "no_phone" };

  const admin = createAdminClient();

  const { data: cfg } = await admin
    .from("bolna_integrations")
    .select(
      "agent_id, from_phone_number, enabled, callbacks_enabled, callback_agent_id, callback_from_phone",
    )
    .eq("organisation_id", organisationId)
    .maybeSingle<CallbackConfigRow>();

  if (!cfg) return { scheduled: false, reason: "no_integration" };
  if (!cfg.enabled) return { scheduled: false, reason: "integration_disabled" };
  if (!cfg.callbacks_enabled) return { scheduled: false, reason: "callbacks_off" };

  // Org-default callback agent, falling back to the integration's default agent
  // so flipping the flag "just works" without forcing a separate selection.
  const agentId = cfg.callback_agent_id?.trim() || cfg.agent_id?.trim() || null;
  if (!agentId) return { scheduled: false, reason: "no_callback_agent" };
  const fromPhone =
    cfg.callback_from_phone?.trim() || cfg.from_phone_number?.trim() || null;

  // Resolve the action for this outcome against the org's policy — only
  // `callback` queues a callback. Unconfigured/absent labels fall to the org's
  // fallback action (typically `succeed`), so they correctly don't.
  const policy = await loadOutcomePolicy(admin, organisationId);
  const outcomeKey = callOutcome ?? FALLBACK_OUTCOME_KEY;
  const action = policy.actions[outcomeKey] ?? policy.fallbackAction;
  if (action !== "callback") {
    return { scheduled: false, reason: `action_${action}` };
  }

  const now = Date.now();
  const whenIso = callbackTime(
    input.requestedCallbackAt,
    DEFAULT_RETRY_INTERVAL_SECONDS,
    now,
  );

  // Idempotent insert: the partial unique index on source_call_id collapses
  // webhook retries to one row. ignoreDuplicates → a retry is a clean no-op.
  const { data, error } = await admin
    .from("scheduled_callbacks")
    .upsert(
      {
        organisation_id: organisationId,
        lead_id: leadId,
        source_call_id: sourceCallId,
        phone: dialPhone,
        agent_id: agentId,
        from_phone: fromPhone,
        status: "pending",
        scheduled_at: whenIso,
        next_attempt_at: whenIso,
        last_outcome: outcomeKey,
        origin: "inbound_outcome",
      },
      { onConflict: "source_call_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    warnSkelo("CALLBACK-SCHEDULE", "Failed to queue inbound callback", {
      organisationId,
      sourceCallId,
      cause: error,
    });
    return { scheduled: false, reason: "insert_failed" };
  }

  // No row back means the conflict path swallowed a duplicate — already queued.
  if (!data) return { scheduled: false, reason: "already_scheduled" };

  console.log("[callbacks] queued inbound callback", {
    organisationId,
    callbackId: data.id,
    sourceCallId,
    agentId,
    when: whenIso,
  });
  return { scheduled: true, callbackId: data.id };
}
