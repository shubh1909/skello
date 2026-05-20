"use server";

import { revalidatePath } from "next/cache";

import { BolnaApiError, initiateBolnaCall } from "@/lib/bolna/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { callInitiateSchema, callListSchema } from "@/lib/validations/call";
import { type ActionResult, fail, ok } from "@/types/action";
import type { Call, CallStatus, CallWithLead } from "@/types/call";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const CALL_COLUMNS =
  "id, organisation_id, lead_id, initiated_by, bolna_call_id, to_phone, from_phone, agent_id, status, direction, error_code, error_message, started_at, answered_at, ended_at, duration_seconds, recording_url, transcript_url, transcript, transcript_status, transcript_fetched_at, language, summary, name_extracted, interest, lead_intent_extracted, actionable, customer_status, visit_scheduled_at, connect_on_whatsapp, lead_data, custom_data, created_at, updated_at";

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

function escapeForOrFilter(input: string): string {
  // PostgREST .or() uses commas as separators and percent for ilike wildcards.
  return input.replace(/[%,]/g, " ").trim();
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

  if (parsed.data.lead_id) query = query.eq("lead_id", parsed.data.lead_id);
  if (parsed.data.status) query = query.eq("status", parsed.data.status);
  if (parsed.data.direction) query = query.eq("direction", parsed.data.direction);
  if (parsed.data.agent_id) query = query.eq("agent_id", parsed.data.agent_id);
  if (parsed.data.from) query = query.gte("started_at", parsed.data.from);
  if (parsed.data.to) query = query.lte("started_at", parsed.data.to);

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

  const ascending = parsed.data.dir === "asc";
  let query = supabase
    .from("calls")
    .select(`${CALL_COLUMNS}, lead:leads(name, phone)`, { count: "exact" })
    .eq("organisation_id", parsed.data.organisation_id)
    .order(parsed.data.sort, { ascending, nullsFirst: false })
    .order("started_at", { ascending: false })
    .range(parsed.data.offset, parsed.data.offset + parsed.data.limit - 1);

  if (parsed.data.lead_id) query = query.eq("lead_id", parsed.data.lead_id);
  if (parsed.data.status) query = query.eq("status", parsed.data.status);
  if (parsed.data.direction) query = query.eq("direction", parsed.data.direction);
  if (parsed.data.agent_id) query = query.eq("agent_id", parsed.data.agent_id);
  if (parsed.data.from) query = query.gte("started_at", parsed.data.from);
  if (parsed.data.to) query = query.lte("started_at", parsed.data.to);
  if (parsed.data.q && parsed.data.q.trim().length > 0) {
    const safe = escapeForOrFilter(parsed.data.q);
    if (safe.length > 0) {
      query = query.or(
        `to_phone.ilike.%${safe}%,from_phone.ilike.%${safe}%,bolna_call_id.ilike.%${safe}%`,
      );
    }
  }

  const { data, error, count } = await query.returns<CallWithLead[]>();
  if (error) return fail(error.message);

  return ok({ items: data ?? [], total: count ?? 0 });
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
