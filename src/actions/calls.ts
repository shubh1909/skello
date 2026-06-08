"use server";

import { revalidatePath } from "next/cache";

import { z } from "zod";

import { BolnaApiError, initiateBolnaCall } from "@/lib/bolna/client";
import { applyCallFilters } from "@/lib/queries/call-filters";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { callInitiateSchema, callListSchema } from "@/lib/validations/call";
import { type ActionResult, fail, ok } from "@/types/action";
import type { Call, CallStatus, CallWithLead } from "@/types/call";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const CALL_COLUMNS =
  "id, organisation_id, lead_id, initiated_by, bolna_call_id, to_phone, from_phone, agent_id, status, direction, error_code, error_message, started_at, answered_at, ended_at, duration_seconds, recording_url, transcript_url, transcript, transcript_status, transcript_fetched_at, language, summary, name_extracted, interest, lead_intent_extracted, actionable, customer_status, visit_scheduled_at, connect_on_whatsapp, lead_data, custom_data, is_test, created_at, updated_at";

const STATUS_MAP: Record<string, CallStatus> = {
  initiated: "initiated",
  queued: "initiated",
  // Bolna defers dials that fall outside the agent's allowed-hours guardrail.
  // We collapse `scheduled` / `rescheduled` into `initiated` so the row keeps
  // moving forward — the actual reason lives in Bolna's execution detail.
  scheduled: "initiated",
  rescheduled: "initiated",
  ringing: "ringing",
  answered: "in_progress",
  "in-progress": "in_progress",
  in_progress: "in_progress",
  completed: "completed",
  ended: "completed",
  failed: "failed",
  "no-answer": "no_answer",
  no_answer: "no_answer",
  busy: "busy",
  canceled: "canceled",
  cancelled: "canceled",
};

function normalizeBolnaStatus(raw: string): CallStatus {
  return STATUS_MAP[raw.toLowerCase()] ?? "initiated";
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

async function userOwnsOrg(
  supabase: SupabaseServerClient,
  userId: string,
  organisationId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("organisations")
    .select("id")
    .eq("id", organisationId)
    .eq("owner_id", userId)
    .maybeSingle<{ id: string }>();
  return !!data;
}

export async function initiateCall(
  input: unknown,
): Promise<ActionResult<Call>> {
  const parsed = callInitiateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");

  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .select("id, org_slug, phone, name")
    .eq("id", parsed.data.lead_id)
    .maybeSingle<{
      id: string;
      org_slug: string | null;
      phone: string | null;
      name: string | null;
    }>();

  if (leadErr) return fail(leadErr.message);
  if (!lead || !lead.org_slug) return fail("Lead not found");
  if (!lead.phone) return fail("No phone on file");

  const { data: org } = await supabase
    .from("organisations")
    .select("id, slug")
    .eq("slug", lead.org_slug)
    .eq("owner_id", user.id)
    .maybeSingle<{ id: string; slug: string }>();
  if (!org) return fail("Forbidden");

  const admin = createAdminClient();
  const { data: integration, error: intErr } = await admin
    .from("bolna_integrations")
    .select("agent_id, api_key, from_phone_number, enabled")
    .eq("organisation_id", org.id)
    .maybeSingle<{
      agent_id: string;
      api_key: string;
      from_phone_number: string | null;
      enabled: boolean;
    }>();

  if (intErr) return fail(intErr.message);
  if (!integration) {
    return fail("Voice agent not configured. Set it up in Settings.");
  }
  if (!integration.enabled) {
    return fail("Voice agent is disabled for this workspace.");
  }

  let bolnaResult;
  try {
    bolnaResult = await initiateBolnaCall({
      apiKey: integration.api_key,
      agentId: integration.agent_id,
      recipientPhone: lead.phone,
      fromPhone: integration.from_phone_number,
      metadata: {
        lead_id: lead.id,
        organisation_id: org.id,
        lead_name: lead.name,
      },
    });
  } catch (err) {
    const reason =
      err instanceof BolnaApiError
        ? err.message
        : "Failed to reach the voice provider";
    await admin.from("calls").insert({
      organisation_id: org.id,
      lead_id: lead.id,
      initiated_by: user.id,
      to_phone: lead.phone,
      from_phone: integration.from_phone_number,
      agent_id: integration.agent_id,
      status: "failed" satisfies CallStatus,
      error_message: reason.slice(0, 500),
    });
    console.error("[calls] initiate failed", err);
    return fail(reason);
  }

  const { data: callRow, error: insertErr } = await admin
    .from("calls")
    .insert({
      organisation_id: org.id,
      lead_id: lead.id,
      initiated_by: user.id,
      bolna_call_id: bolnaResult.bolnaCallId,
      direction: "outbound",
      to_phone: lead.phone,
      from_phone: integration.from_phone_number,
      agent_id: integration.agent_id,
      status: normalizeBolnaStatus(bolnaResult.status),
    })
    .select(CALL_COLUMNS)
    .single<Call>();

  if (insertErr) return fail(insertErr.message);

  revalidatePath("/leads");
  revalidatePath("/dashboard");
  return ok(callRow);
}

// E.164 format: leading + then country code (1-9) then 6-14 more digits.
// Strict to avoid silently feeding the provider a junk number — the test
// dialog displays a clear validation error rather than wasting a billable
// call attempt on a typo.
const e164Schema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, "Phone must be in E.164 form, e.g. +14155551234");

const testCallSchema = z.object({
  organisation_id: z.string().uuid(),
  // Pick an agent the org has configured (validated server-side against
  // the integration's agent_labels). Required even when there's only one
  // agent — keeps the contract explicit and forward-compatible.
  agent_id: z.string().trim().min(1).max(200),
  // Optional override of the integration's default from_phone_number. When
  // null/omitted the integration default is used; when set it must match
  // one of the entries in from_phone_labels (no arbitrary spoofing).
  from_phone: z.string().trim().min(1).max(20).optional(),
  to_phone: e164Schema,
});

export type InitiateTestCallInput = z.infer<typeof testCallSchema>;

/**
 * Fire a one-off voice-agent call from the Campaigns > Test Call dialog.
 *
 * Differs from initiateCall (the lead-based path):
 *   - no lead lookup; no lead_id on the inserted row
 *   - is_test = true so the post-call webhook skips lead-merge and the
 *     headline stat cards exclude it
 *   - caller can override agent / from-phone within the org's configured set
 *
 * Use case: sales engineers giving a live demo to a prospect. The call
 * still lands in Conversations so the transcript and recording are
 * replayable afterwards.
 */
export async function initiateTestCall(
  input: unknown,
): Promise<ActionResult<Call>> {
  const parsed = testCallSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userOwnsOrg(supabase, user.id, parsed.data.organisation_id))) {
    return fail("Forbidden");
  }

  // 10 test calls per hour per org. Test calls fire real billable
  // dials through the voice provider; the cap stops an operator (or
  // a compromised session inside an org) from running up a bill or
  // turning the workspace into a robo-dialer. Keyed on org so a
  // shared workspace doesn't penalise quieter teammates.
  const rl = await checkRateLimit({
    key: `test-call:org:${parsed.data.organisation_id}`,
    windowSeconds: 3600,
    max: 10,
  });
  if (!rl.allowed) {
    return fail(
      `Test-call limit reached. Try again in ${rl.retryAfterSeconds}s.`,
    );
  }

  // Admin client only here — bolna_integrations is service-role per
  // baseline RLS. We've already proven org ownership above so this is
  // not a privilege escalation.
  const admin = createAdminClient();
  const { data: integration, error: intErr } = await admin
    .from("bolna_integrations")
    .select(
      "agent_id, agent_labels, api_key, from_phone_number, from_phone_labels, enabled",
    )
    .eq("organisation_id", parsed.data.organisation_id)
    .maybeSingle<{
      agent_id: string;
      agent_labels: Record<string, unknown> | null;
      api_key: string;
      from_phone_number: string | null;
      from_phone_labels: Record<string, unknown> | null;
      enabled: boolean;
    }>();

  if (intErr) return fail(intErr.message);
  if (!integration) {
    return fail("Voice agent not configured. Set it up in Settings.");
  }
  if (!integration.enabled) {
    return fail("Voice agent is disabled for this workspace.");
  }

  // Allow either the configured default agent_id or one explicitly named
  // in agent_labels. Same rule as the dispatcher uses — keeps the org's
  // catalogue authoritative.
  const knownAgents = new Set<string>();
  if (integration.agent_id) knownAgents.add(integration.agent_id);
  for (const k of Object.keys(integration.agent_labels ?? {})) {
    knownAgents.add(k);
  }
  if (!knownAgents.has(parsed.data.agent_id)) {
    return fail("Unknown agent for this workspace.");
  }

  // Resolve the from-phone: explicit override (must be in the catalogue)
  // or fall back to the integration default. The catalogue check prevents
  // an operator passing an arbitrary number that the provider would
  // happily dial — keeps caller-ID truthful to the org's config.
  let fromPhone: string | null;
  if (parsed.data.from_phone) {
    const knownNumbers = new Set<string>();
    if (integration.from_phone_number) {
      knownNumbers.add(integration.from_phone_number);
    }
    for (const k of Object.keys(integration.from_phone_labels ?? {})) {
      knownNumbers.add(k);
    }
    if (!knownNumbers.has(parsed.data.from_phone)) {
      return fail("Unknown dialling number for this workspace.");
    }
    fromPhone = parsed.data.from_phone;
  } else {
    fromPhone = integration.from_phone_number;
  }

  let bolnaResult;
  try {
    bolnaResult = await initiateBolnaCall({
      apiKey: integration.api_key,
      agentId: parsed.data.agent_id,
      recipientPhone: parsed.data.to_phone,
      fromPhone,
      metadata: {
        organisation_id: parsed.data.organisation_id,
        is_test: true,
      },
    });
  } catch (err) {
    const reason =
      err instanceof BolnaApiError
        ? err.message
        : "Failed to reach the voice provider";
    // Still record the failed attempt so the operator sees it in the
    // dialog history and isn't left wondering whether it dialed.
    await admin.from("calls").insert({
      organisation_id: parsed.data.organisation_id,
      initiated_by: user.id,
      to_phone: parsed.data.to_phone,
      from_phone: fromPhone,
      agent_id: parsed.data.agent_id,
      status: "failed" satisfies CallStatus,
      direction: "outbound",
      is_test: true,
      error_message: reason.slice(0, 500),
    });
    console.error("[calls] test initiate failed", err);
    return fail(reason);
  }

  const { data: callRow, error: insertErr } = await admin
    .from("calls")
    .insert({
      organisation_id: parsed.data.organisation_id,
      initiated_by: user.id,
      bolna_call_id: bolnaResult.bolnaCallId,
      direction: "outbound",
      to_phone: parsed.data.to_phone,
      from_phone: fromPhone,
      agent_id: parsed.data.agent_id,
      status: normalizeBolnaStatus(bolnaResult.status),
      is_test: true,
    })
    .select(CALL_COLUMNS)
    .single<Call>();

  if (insertErr) return fail(insertErr.message);

  // Test calls don't appear in /leads (no lead_id) so we skip that
  // revalidation. Conversations rebuilds via realtime channels and the
  // initial server fetch on next navigation — no manual revalidate.
  return ok(callRow);
}

export async function listCalls(
  input: unknown,
): Promise<ActionResult<{ items: Call[]; total: number }>> {
  const parsed = callListSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userOwnsOrg(supabase, user.id, parsed.data.organisation_id))) {
    return fail("Forbidden");
  }

  const ascending = parsed.data.dir === "asc";
  let query = supabase
    .from("calls")
    .select(CALL_COLUMNS, { count: "exact" })
    .eq("organisation_id", parsed.data.organisation_id)
    // Primary sort comes from the caller; started_at is the tiebreaker so
    // identical durations / agents / statuses stay in a stable order across
    // infinite-scroll pages.
    .order(parsed.data.sort, { ascending, nullsFirst: false })
    .order("started_at", { ascending: false })
    .range(parsed.data.offset, parsed.data.offset + parsed.data.limit - 1);

  query = applyCallFilters(query, parsed.data);

  const { data, error, count } = await query.returns<Call[]>();
  if (error) return fail(error.message);

  return ok({ items: data ?? [], total: count ?? 0 });
}

export async function listConversations(
  input: unknown,
): Promise<ActionResult<{ items: CallWithLead[]; total: number }>> {
  const parsed = callListSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userOwnsOrg(supabase, user.id, parsed.data.organisation_id))) {
    return fail("Forbidden");
  }

  // Campaign scoping: resolve the campaign's contact ids and constrain the
  // call query to those. Done here (not in the generic filter helper) so the
  // helper stays free of an extra round-trip.
  let campaignContactIds: string[] | undefined;
  if (parsed.data.campaign_id) {
    const ids = await resolveCampaignContactIds(
      supabase,
      parsed.data.organisation_id,
      parsed.data.campaign_id,
    );
    if (ids === null) return fail("Campaign not found");
    campaignContactIds = ids;
  }

  const ascending = parsed.data.dir === "asc";
  let query = supabase
    .from("calls")
    .select(`${CALL_COLUMNS}, lead:leads(name, phone)`, { count: "exact" })
    .eq("organisation_id", parsed.data.organisation_id)
    .order(parsed.data.sort, { ascending, nullsFirst: false })
    .order("started_at", { ascending: false })
    .range(parsed.data.offset, parsed.data.offset + parsed.data.limit - 1);

  query = applyCallFilters(query, {
    ...parsed.data,
    campaign_contact_ids: campaignContactIds,
  });

  const { data, error, count } = await query.returns<CallWithLead[]>();
  if (error) return fail(error.message);

  return ok({ items: data ?? [], total: count ?? 0 });
}

// Resolve a campaign's contact-id set, verifying the campaign belongs to the
// org. Returns null if the campaign doesn't exist (or is cross-tenant), or a
// (possibly empty) id array otherwise.
async function resolveCampaignContactIds(
  supabase: SupabaseServerClient,
  organisationId: string,
  campaignId: string,
): Promise<string[] | null> {
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", campaignId)
    .eq("organisation_id", organisationId)
    .maybeSingle<{ id: string }>();
  if (!campaign) return null;

  const { data: contacts } = await supabase
    .from("campaign_contacts")
    .select("id")
    .eq("campaign_id", campaignId)
    .returns<{ id: string }[]>();
  return (contacts ?? []).map((c) => c.id);
}

export interface ConversationAgentOption {
  id: string;
  label: string;
}

export async function listConversationAgents(
  organisationId: string,
): Promise<ActionResult<ConversationAgentOption[]>> {
  if (!organisationId) return fail("Missing organisation id");

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userOwnsOrg(supabase, user.id, organisationId))) {
    return fail("Forbidden");
  }

  // Recently active agents from the calls table — drives which agents appear
  // in the filter. We pull the latest 500 rows and dedupe; an org with more
  // than ~500 active agents in the recent window is not realistic.
  const { data: callRows, error: callsErr } = await supabase
    .from("calls")
    .select("agent_id")
    .eq("organisation_id", organisationId)
    .order("started_at", { ascending: false })
    .limit(500)
    .returns<{ agent_id: string }[]>();

  if (callsErr) return fail(callsErr.message);
  const agentIds = Array.from(
    new Set((callRows ?? []).map((r) => r.agent_id).filter(Boolean)),
  );
  if (agentIds.length === 0) return ok([]);

  // Resolve human-readable labels from voice_agents. Org-scoped read so we
  // never leak another tenant's label even if an agent_id collided.
  const { data: agentRows, error: agentsErr } = await supabase
    .from("voice_agents")
    .select("agent_id, label")
    .eq("organisation_id", organisationId)
    .in("agent_id", agentIds)
    .returns<{ agent_id: string; label: string | null }[]>();

  if (agentsErr) return fail(agentsErr.message);
  const labelById = new Map(
    (agentRows ?? []).map((r) => [r.agent_id, r.label?.trim() || null]),
  );

  const options: ConversationAgentOption[] = agentIds.map((id) => ({
    id,
    label: labelById.get(id) ?? id,
  }));
  // Stable display order — by label so the dropdown reads alphabetically.
  options.sort((a, b) => a.label.localeCompare(b.label));
  return ok(options);
}
