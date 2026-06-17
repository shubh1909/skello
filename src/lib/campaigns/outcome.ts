import "server-only";

import {
  decideOutcome,
  isTerminalCallStatus,
} from "@/lib/campaigns/outcome-decision";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CallOutcome, CallStatus } from "@/types/call";
import type { CampaignRetryTrigger } from "@/types/campaign";
import {
  FALLBACK_OUTCOME_KEY,
  type OutcomeAction,
  type ResolvedOutcomePolicy,
} from "@/types/outcome-policy";

// Safe policy when an org has none (brand-new, pre-backfill): treat every
// outcome as a success — the pre-config default — so nothing ever stalls.
const EMPTY_POLICY: ResolvedOutcomePolicy = {
  actions: {},
  fallbackAction: "succeed",
};

// Build the resolved outcome policy for an org from org_outcome_policies.
// Exported so the inbound-callback scheduler resolves the `callback` action
// against the SAME policy the campaign applier uses — one source of truth.
export async function loadOutcomePolicy(
  admin: ReturnType<typeof createAdminClient>,
  organisationId: string,
): Promise<ResolvedOutcomePolicy> {
  const { data } = await admin
    .from("org_outcome_policies")
    .select("outcome_key, action, is_fallback")
    .eq("organisation_id", organisationId)
    .returns<
      { outcome_key: string; action: OutcomeAction; is_fallback: boolean }[]
    >();

  if (!data || data.length === 0) return EMPTY_POLICY;

  const actions: Record<string, OutcomeAction> = {};
  let fallbackAction: OutcomeAction | null = null;
  for (const row of data) {
    actions[row.outcome_key] = row.action;
    if (row.is_fallback) fallbackAction = row.action;
  }
  return {
    actions,
    fallbackAction:
      fallbackAction ?? actions[FALLBACK_OUTCOME_KEY] ?? "succeed",
  };
}

interface ApplyOutcomeInput {
  contactId: string;
  callId: string;
  callStatus: CallStatus;
  // Semantic disposition + requested callback time, available only on the final
  // (extracted_data) webhook. Omitted on the status-only path — a `completed`
  // call with no disposition falls back to "succeeded".
  callOutcome?: CallOutcome | null;
  requestedCallbackAt?: string | null;
}

interface ContactRow {
  id: string;
  campaign_id: string;
  organisation_id: string;
  phone: string;
  name: string | null;
  attempt: number;
  callback_count: number;
  status: string;
  lead_id: string | null;
  last_call_id: string | null;
  campaign: {
    id: string;
    max_attempts: number;
    max_callbacks: number;
    retry_interval_seconds: number;
    retry_on: CampaignRetryTrigger[];
    organisation_id: string;
  } | null;
}

/**
 * Run after a Bolna webhook updates a call row. Loads the contact, asks the
 * pure {@link decideOutcome} core what to do, then applies it (the only I/O
 * here: the contact load, the lead conversion on success, and the write).
 *
 * The decision branches on TWO axes — the technical `callStatus` and the
 * semantic `call_outcome` disposition — see outcome-decision.ts for the table.
 *
 * Idempotent: every write is guarded by `.eq('status','in_flight')`, so a
 * duplicate webhook delivery for an already-finalised contact is a no-op.
 */
export async function applyCampaignContactOutcome({
  contactId,
  callId,
  callStatus,
  callOutcome = null,
  requestedCallbackAt = null,
}: ApplyOutcomeInput): Promise<void> {
  // Cheap guard before the DB read — non-terminal statuses are no-ops.
  if (!isTerminalCallStatus(callStatus)) return;

  const admin = createAdminClient();

  const { data: contact } = await admin
    .from("campaign_contacts")
    .select(
      "id, campaign_id, organisation_id, phone, name, attempt, callback_count, status, lead_id, last_call_id, campaign:campaigns!campaign_id(id, max_attempts, max_callbacks, retry_interval_seconds, retry_on, organisation_id)",
    )
    .eq("id", contactId)
    .maybeSingle<ContactRow>();

  if (!contact || !contact.campaign) return;
  // Only act on a contact we currently hold the dial claim for. Guards against
  // a duplicate/late webhook re-deciding an already-resolved contact.
  if (contact.status !== "in_flight") return;

  // The outcome policy only matters for the disposition tier (completed calls);
  // technical statuses (no_answer/busy/…) are decided from retry_on alone, so
  // skip the extra query on that hot path.
  const policy =
    callStatus === "completed"
      ? await loadOutcomePolicy(admin, contact.organisation_id)
      : EMPTY_POLICY;

  const decision = decideOutcome({
    callStatus,
    callOutcome,
    requestedCallbackAt,
    callId,
    attempt: contact.attempt,
    callbackCount: contact.callback_count,
    campaign: {
      max_attempts: contact.campaign.max_attempts,
      max_callbacks: contact.campaign.max_callbacks,
      retry_interval_seconds: contact.campaign.retry_interval_seconds,
      retry_on: contact.campaign.retry_on,
    },
    policy,
    now: Date.now(),
  });

  if (decision.kind === "noop") return;

  if (decision.kind === "succeed") {
    // Lead conversion is the one I/O the decision can't make itself.
    let leadId = contact.lead_id;
    if (!leadId) {
      leadId = await convertContactToLead({
        organisationId: contact.organisation_id,
        phone: contact.phone,
        name: contact.name,
      });
    }
    await admin
      .from("campaign_contacts")
      .update({ ...decision.patch, lead_id: leadId })
      .eq("id", contact.id)
      .eq("status", "in_flight");
    return;
  }

  // fail / rearm — the patch is complete as decided.
  await admin
    .from("campaign_contacts")
    .update(decision.patch)
    .eq("id", contact.id)
    .eq("status", "in_flight");
}

/**
 * Look up an existing lead by exact phone within the org's slug; create one
 * if absent. Leads use `org_slug` (text) as the tenant column, so we resolve
 * the slug before writing.
 */
async function convertContactToLead({
  organisationId,
  phone,
  name,
}: {
  organisationId: string;
  phone: string;
  name: string | null;
}): Promise<string | null> {
  const admin = createAdminClient();

  const { data: org } = await admin
    .from("organisations")
    .select("slug")
    .eq("id", organisationId)
    .maybeSingle<{ slug: string }>();
  if (!org) return null;

  const { data: existing } = await admin
    .from("leads")
    .select("id")
    .eq("org_slug", org.slug)
    .eq("phone", phone)
    .maybeSingle<{ id: string }>();
  if (existing) return existing.id;

  const { data: created, error } = await admin
    .from("leads")
    .insert({
      org_slug: org.slug,
      name: name,
      phone,
      source: "manual",
      status: "contacted",
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    console.error("[campaigns] lead conversion failed", error);
    return null;
  }
  return created.id;
}
