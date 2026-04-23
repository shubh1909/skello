"use server";

import { revalidatePath } from "next/cache";

import { BolnaApiError, initiateBolnaCall } from "@/lib/bolna/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { callInitiateSchema, callListSchema } from "@/lib/validations/call";
import { type ActionResult, fail, ok } from "@/types/action";
import type { Call, CallStatus } from "@/types/call";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const CALL_COLUMNS =
  "id, organisation_id, lead_id, initiated_by, bolna_call_id, to_phone, from_phone, agent_id, status, error_code, error_message, started_at, answered_at, ended_at, duration_seconds, recording_url, transcript_url, summary, created_at, updated_at";

const STATUS_MAP: Record<string, CallStatus> = {
  initiated: "initiated",
  queued: "initiated",
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
    return fail("Bolna integration not configured. Set it up in Settings.");
  }
  if (!integration.enabled) {
    return fail("Bolna integration is disabled for this organisation.");
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
      err instanceof BolnaApiError ? err.message : "Failed to reach Bolna";
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

  let query = supabase
    .from("calls")
    .select(CALL_COLUMNS, { count: "exact" })
    .eq("organisation_id", parsed.data.organisation_id)
    .order("started_at", { ascending: false })
    .range(parsed.data.offset, parsed.data.offset + parsed.data.limit - 1);

  if (parsed.data.lead_id) query = query.eq("lead_id", parsed.data.lead_id);
  if (parsed.data.status) query = query.eq("status", parsed.data.status);

  const { data, error, count } = await query.returns<Call[]>();
  if (error) return fail(error.message);

  return ok({ items: data ?? [], total: count ?? 0 });
}
