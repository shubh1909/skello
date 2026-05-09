import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { CallStatus } from "@/types/call";
import type { CampaignRetryTrigger } from "@/types/campaign";

const RETRY_ELIGIBLE: ReadonlySet<CallStatus> = new Set<CallStatus>([
  "no_answer",
  "busy",
  "failed",
  "canceled",
]);

const TERMINAL_STATUSES: ReadonlySet<CallStatus> = new Set<CallStatus>([
  "completed",
  "no_answer",
  "busy",
  "failed",
  "canceled",
]);

interface ApplyOutcomeInput {
  contactId: string;
  callId: string;
  callStatus: CallStatus;
}

/**
 * Run after the Bolna webhook updates a call row. Decides what to do with
 * the parent campaign_contact:
 *   - completed                                  → succeeded (+ lead upsert)
 *   - retry-eligible AND attempt < max_attempts  → re-arm pending
 *   - retry-eligible AND cap hit                 → failed
 *   - non-terminal status (ringing, in_progress) → no-op
 *
 * Idempotent: status transitions out of in_flight are guarded by a
 * .eq('status','in_flight') predicate on the update.
 */
export async function applyCampaignContactOutcome({
  contactId,
  callId,
  callStatus,
}: ApplyOutcomeInput): Promise<void> {
  if (!TERMINAL_STATUSES.has(callStatus)) return;

  const admin = createAdminClient();

  const { data: contact } = await admin
    .from("campaign_contacts")
    .select(
      "id, campaign_id, organisation_id, phone, name, attempt, status, lead_id, last_call_id, campaign:campaigns!campaign_id(id, max_attempts, retry_interval_seconds, retry_on, organisation_id)",
    )
    .eq("id", contactId)
    .maybeSingle<{
      id: string;
      campaign_id: string;
      organisation_id: string;
      phone: string;
      name: string | null;
      attempt: number;
      status: string;
      lead_id: string | null;
      last_call_id: string | null;
      campaign: {
        id: string;
        max_attempts: number;
        retry_interval_seconds: number;
        retry_on: CampaignRetryTrigger[];
        organisation_id: string;
      } | null;
    }>();

  if (!contact || !contact.campaign) return;

  const basePatch: Record<string, unknown> = {
    last_status: callStatus,
    last_call_id: callId,
  };

  if (callStatus === "completed") {
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
      .update({
        ...basePatch,
        status: "succeeded",
        lead_id: leadId,
        last_error: null,
      })
      .eq("id", contact.id);
    return;
  }

  const isRetryable =
    contact.campaign.retry_on.includes(callStatus as CampaignRetryTrigger) &&
    RETRY_ELIGIBLE.has(callStatus);

  const capHit = contact.attempt >= contact.campaign.max_attempts;

  if (isRetryable && !capHit) {
    const next = new Date(
      Date.now() + contact.campaign.retry_interval_seconds * 1000,
    ).toISOString();
    await admin
      .from("campaign_contacts")
      .update({
        ...basePatch,
        status: "pending",
        next_attempt_at: next,
      })
      .eq("id", contact.id);
    return;
  }

  await admin
    .from("campaign_contacts")
    .update({
      ...basePatch,
      status: "failed",
    })
    .eq("id", contact.id);
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
