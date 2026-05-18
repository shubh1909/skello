"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";

import { dispatchDueCampaignContacts } from "@/lib/campaigns/dispatch";
import { logSkeloError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  campaignIdSchema,
  createCampaignSchema,
  listCampaignsSchema,
} from "@/lib/validations/campaign";
import { type ActionResult, fail, ok } from "@/types/action";
import type { CallStatus, CallDirection } from "@/types/call";
import type { Campaign, CampaignContact } from "@/types/campaign";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const CAMPAIGN_COLUMNS =
  "id, organisation_id, created_by, name, file_name, agent_id, from_phone_number, status, scheduled_at, started_at, completed_at, max_attempts, retry_interval_seconds, retry_on, total_contacts, valid_contacts, succeeded_count, failed_count, in_flight_count, created_at, updated_at";

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

export async function createCampaign(
  input: unknown,
): Promise<ActionResult<Campaign>> {
  const parsed = createCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userOwnsOrg(supabase, user.id, parsed.data.organisation_id))) {
    return fail("Forbidden");
  }

  if (parsed.data.schedule_mode === "later" && !parsed.data.scheduled_at) {
    return fail("Pick a date and time for the scheduled run");
  }

  const admin = createAdminClient();

  // Confirm the org has an outbound voice agent configured. After the
  // remodel, agents live in the `voice_agents` registry (one row per agent,
  // PK = agent_id, FK to org); `bolna_integrations` keeps just the API key,
  // default agent, and dialling-number list.
  const { data: integration, error: integrationErr } = await admin
    .from("bolna_integrations")
    .select("agent_id, from_phone_number, from_phone_numbers, enabled")
    .eq("organisation_id", parsed.data.organisation_id)
    .maybeSingle<{
      agent_id: string;
      from_phone_number: string | null;
      from_phone_numbers: string[];
      enabled: boolean;
    }>();
  if (integrationErr) {
    return fail(
      logSkeloError("CAMPAIGN", "Could not read voice provider config", {
        organisationId: parsed.data.organisation_id,
        cause: integrationErr,
      }),
    );
  }
  if (!integration) return fail("Voice agent not configured. Set it up in Settings.");
  if (!integration.enabled) return fail("Voice agent is disabled for this workspace.");

  // Agent validation: pull every claimed agent for this workspace from the
  // voice_agents registry. The default agent_id from bolna_integrations is
  // also always allowed (it should be registered too, but we belt-and-
  // suspenders the case where backfill missed something).
  const { data: agentRows, error: agentErr } = await admin
    .from("voice_agents")
    .select("agent_id, enabled")
    .eq("organisation_id", parsed.data.organisation_id);
  if (agentErr) {
    return fail(
      logSkeloError("CAMPAIGN", "Could not list workspace voice agents", {
        organisationId: parsed.data.organisation_id,
        cause: agentErr,
      }),
    );
  }
  const allowedAgents = new Set<string>([
    integration.agent_id,
    ...((agentRows ?? [])
      .filter((a) => a.enabled !== false)
      .map((a) => a.agent_id)),
  ]);
  if (parsed.data.agent_id && !allowedAgents.has(parsed.data.agent_id)) {
    return fail("Selected agent is not linked to this workspace");
  }
  const allowedNumbers = new Set<string>([
    ...(integration.from_phone_number ? [integration.from_phone_number] : []),
    ...(integration.from_phone_numbers ?? []),
  ]);
  if (
    parsed.data.from_phone_number &&
    !allowedNumbers.has(parsed.data.from_phone_number)
  ) {
    return fail("Selected dialling number is not in this workspace's saved numbers");
  }

  const isRunNow = parsed.data.schedule_mode === "now";
  const scheduledAt = isRunNow ? null : parsed.data.scheduled_at!;

  const { data: campaignRow, error: campaignErr } = await admin
    .from("campaigns")
    .insert({
      organisation_id: parsed.data.organisation_id,
      created_by: user.id,
      name: parsed.data.name,
      file_name: parsed.data.file_name ?? null,
      agent_id: parsed.data.agent_id,
      from_phone_number: parsed.data.from_phone_number,
      status: isRunNow ? "in_progress" : "scheduled",
      scheduled_at: scheduledAt,
      started_at: isRunNow ? new Date().toISOString() : null,
      max_attempts: parsed.data.max_attempts,
      retry_interval_seconds: parsed.data.retry_interval_seconds,
      retry_on: parsed.data.retry_on,
    })
    .select(CAMPAIGN_COLUMNS)
    .single<Campaign>();

  if (campaignErr || !campaignRow) {
    return fail(campaignErr?.message ?? "Could not create campaign");
  }

  // Bulk-insert contacts. Conflicts on (campaign_id, phone) are silently
  // dropped — the dedupe constraint enforces uniqueness within a campaign.
  const firstAttemptAt = isRunNow
    ? new Date().toISOString()
    : scheduledAt;

  const contactRows = parsed.data.contacts.map((c) => ({
    campaign_id: campaignRow.id,
    organisation_id: parsed.data.organisation_id,
    raw_phone: c.raw_phone,
    phone: c.phone,
    name: c.name ?? null,
    metadata: c.metadata,
    status: "pending" as const,
    next_attempt_at: firstAttemptAt,
  }));

  const { error: contactsErr } = await admin
    .from("campaign_contacts")
    .insert(contactRows);

  if (contactsErr) {
    // Roll back the campaign so the user isn't left with an empty shell.
    await admin.from("campaigns").delete().eq("id", campaignRow.id);
    return fail(contactsErr.message);
  }

  // Kick off dispatch immediately for "Run Now" campaigns. The cron will
  // also tick this in production, but firing inline means:
  //   - Local dev: no need for pg_cron / a public URL — the dispatch runs
  //     in-process, so dials happen as soon as the campaign is created.
  //   - Production: operator sees the first wave land within seconds
  //     instead of waiting up to a minute for the next cron tick.
  // `after()` runs the work after the response is sent to the client.
  if (isRunNow) {
    after(async () => {
      try {
        const result = await dispatchDueCampaignContacts();
        console.log("[campaigns] inline dispatch", {
          campaignId: campaignRow.id,
          ...result,
        });
      } catch (err) {
        console.error("[campaigns] inline dispatch failed", err);
      }
    });
  }

  revalidatePath("/campaigns");
  return ok(campaignRow);
}

export async function runCampaignNow(
  input: unknown,
): Promise<ActionResult<Campaign>> {
  const parsed = campaignIdSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid id");

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("campaigns")
    .select("id, organisation_id, status")
    .eq("id", parsed.data.id)
    .maybeSingle<{ id: string; organisation_id: string; status: string }>();
  if (!existing) return fail("Campaign not found");
  if (!(await userOwnsOrg(supabase, user.id, existing.organisation_id))) {
    return fail("Forbidden");
  }
  if (existing.status === "in_progress") return fail("Campaign is already running");

  const now = new Date().toISOString();

  // Re-arm pending contacts so the cron tick (or an immediate manual tick)
  // picks them up. We don't touch contacts that are already terminal.
  const { error: armErr } = await admin
    .from("campaign_contacts")
    .update({ next_attempt_at: now })
    .eq("campaign_id", existing.id)
    .eq("status", "pending");
  if (armErr) return fail(armErr.message);

  const { data, error } = await admin
    .from("campaigns")
    .update({
      status: "in_progress",
      started_at: now,
      completed_at: null,
    })
    .eq("id", existing.id)
    .select(CAMPAIGN_COLUMNS)
    .single<Campaign>();

  if (error || !data) return fail(error?.message ?? "Could not start campaign");

  // Same inline dispatch as createCampaign — flip-to-running should also
  // dial immediately rather than waiting for the next cron tick.
  after(async () => {
    try {
      const result = await dispatchDueCampaignContacts();
      console.log("[campaigns] inline dispatch (run-now)", {
        campaignId: data.id,
        ...result,
      });
    } catch (err) {
      console.error("[campaigns] inline dispatch failed", err);
    }
  });

  revalidatePath("/campaigns");
  return ok(data);
}

export async function stopCampaign(
  input: unknown,
): Promise<ActionResult<Campaign>> {
  const parsed = campaignIdSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid id");

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("campaigns")
    .select("id, organisation_id")
    .eq("id", parsed.data.id)
    .maybeSingle<{ id: string; organisation_id: string }>();
  if (!existing) return fail("Campaign not found");
  if (!(await userOwnsOrg(supabase, user.id, existing.organisation_id))) {
    return fail("Forbidden");
  }

  // Skip every still-pending contact. In-flight calls keep running — their
  // webhook will resolve them and the trigger will flip the campaign to
  // 'completed' once nothing remains in pending or in_flight.
  const { error: skipErr } = await admin
    .from("campaign_contacts")
    .update({ status: "skipped" })
    .eq("campaign_id", existing.id)
    .eq("status", "pending");
  if (skipErr) return fail(skipErr.message);

  const { data, error } = await admin
    .from("campaigns")
    .update({ status: "stopped", completed_at: new Date().toISOString() })
    .eq("id", existing.id)
    .select(CAMPAIGN_COLUMNS)
    .single<Campaign>();

  if (error || !data) return fail(error?.message ?? "Could not stop campaign");

  revalidatePath("/campaigns");
  return ok(data);
}

export async function deleteCampaign(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = campaignIdSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid id");

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("campaigns")
    .select("id, organisation_id")
    .eq("id", parsed.data.id)
    .maybeSingle<{ id: string; organisation_id: string }>();
  if (!existing) return fail("Campaign not found");
  if (!(await userOwnsOrg(supabase, user.id, existing.organisation_id))) {
    return fail("Forbidden");
  }

  // Cascade drops campaign_contacts; calls.campaign_contact_id becomes null
  // (history preserved on the calls table).
  const { error } = await admin.from("campaigns").delete().eq("id", existing.id);
  if (error) return fail(error.message);

  revalidatePath("/campaigns");
  return ok({ id: existing.id });
}

export async function listCampaigns(
  input: unknown,
): Promise<ActionResult<{ items: Campaign[]; total: number }>> {
  const parsed = listCampaignsSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userOwnsOrg(supabase, user.id, parsed.data.organisation_id))) {
    return fail("Forbidden");
  }

  let query = supabase
    .from("campaigns")
    .select(CAMPAIGN_COLUMNS, { count: "exact" })
    .eq("organisation_id", parsed.data.organisation_id)
    .order("created_at", { ascending: false })
    .range(parsed.data.offset, parsed.data.offset + parsed.data.limit - 1);

  if (parsed.data.status) query = query.eq("status", parsed.data.status);

  const { data, error, count } = await query.returns<Campaign[]>();
  if (error) return fail(error.message);

  return ok({ items: data ?? [], total: count ?? 0 });
}

export interface CampaignCallRow {
  id: string;
  organisation_id: string;
  campaign_contact_id: string | null;
  to_phone: string | null;
  from_phone: string | null;
  status: CallStatus;
  direction: CallDirection;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  error_message: string | null;
  contact: Pick<CampaignContact, "id" | "phone" | "name" | "attempt"> | null;
}

export async function getCampaignCalls(
  input: unknown,
): Promise<ActionResult<CampaignCallRow[]>> {
  const parsed = campaignIdSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid id");

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");

  const admin = createAdminClient();
  const { data: campaign } = await admin
    .from("campaigns")
    .select("id, organisation_id")
    .eq("id", parsed.data.id)
    .maybeSingle<{ id: string; organisation_id: string }>();
  if (!campaign) return fail("Campaign not found");
  if (!(await userOwnsOrg(supabase, user.id, campaign.organisation_id))) {
    return fail("Forbidden");
  }

  const { data: contacts, error: cErr } = await admin
    .from("campaign_contacts")
    .select("id")
    .eq("campaign_id", campaign.id);
  if (cErr) return fail(cErr.message);
  const ids = (contacts ?? []).map((c) => c.id);
  if (ids.length === 0) return ok([]);

  const { data, error } = await admin
    .from("calls")
    .select(
      "id, organisation_id, campaign_contact_id, to_phone, from_phone, status, direction, started_at, answered_at, ended_at, duration_seconds, recording_url, error_message, contact:campaign_contacts!campaign_contact_id(id, phone, name, attempt)",
    )
    .in("campaign_contact_id", ids)
    .order("started_at", { ascending: false })
    .returns<CampaignCallRow[]>();

  if (error) return fail(error.message);
  return ok(data ?? []);
}
