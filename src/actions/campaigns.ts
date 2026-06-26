"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";

import {
  RESOLVED_CALL_STATUSES,
  dispatchDueCampaignContacts,
} from "@/lib/campaigns/dispatch";
import { logSkeloError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  campaignIdSchema,
  createCampaignSchema,
  listCampaignsSchema,
} from "@/lib/validations/campaign";
import { pickBestOutcome } from "@/lib/campaigns/best-disposition";
import { loadOutcomeRanking } from "@/lib/queries/outcome-ranking";
import { type ActionResult, fail, ok } from "@/types/action";
import type { CallStatus, CallDirection } from "@/types/call";
import type {
  Campaign,
  CampaignContact,
  CampaignListItem,
} from "@/types/campaign";
import { FALLBACK_OUTCOME_KEY } from "@/types/outcome-policy";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const CAMPAIGN_COLUMNS =
  "id, organisation_id, created_by, name, file_name, agent_id, from_phone_number, from_phone_numbers, status, scheduled_at, started_at, completed_at, max_attempts, max_callbacks, retry_interval_seconds, retry_on, switch_connect_rate_floor, switch_window_minutes, switch_min_samples, calling_window_start_minute, calling_window_end_minute, calling_window_days, calling_window_timezone, total_contacts, valid_contacts, succeeded_count, failed_count, in_flight_count, created_at, updated_at";

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

  // Validate the rotation pool: every chosen number must be a saved workspace
  // number. De-dupe while preserving order. An empty pool is fine — dispatch
  // falls back to from_phone_number then the org default.
  const pool: string[] = [];
  for (const n of parsed.data.from_phone_numbers) {
    if (!allowedNumbers.has(n)) {
      return fail(`Dialling number ${n} is not in this workspace's saved numbers`);
    }
    if (!pool.includes(n)) pool.push(n);
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
      from_phone_numbers: pool,
      status: isRunNow ? "in_progress" : "scheduled",
      scheduled_at: scheduledAt,
      started_at: isRunNow ? new Date().toISOString() : null,
      max_attempts: parsed.data.max_attempts,
      retry_interval_seconds: parsed.data.retry_interval_seconds,
      retry_on: parsed.data.retry_on,
      switch_connect_rate_floor: parsed.data.switch_connect_rate_floor,
      switch_window_minutes: parsed.data.switch_window_minutes,
      switch_min_samples: parsed.data.switch_min_samples,
      // Calling window: all-or-nothing. Null window → all three columns null and
      // an empty day set (the DB default), meaning "dial any time".
      calling_window_start_minute:
        parsed.data.calling_window?.start_minute ?? null,
      calling_window_end_minute: parsed.data.calling_window?.end_minute ?? null,
      calling_window_days: parsed.data.calling_window?.days ?? [],
      calling_window_timezone: parsed.data.calling_window?.timezone ?? null,
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

// Soft-delete a campaign and its footprint: the campaign hides from every
// org-facing surface (list, detail, exports) while every row stays intact in
// the DB. Leads this campaign SOLELY created are hidden too; leads it shared
// with inbound/manual/other campaigns stay, with only this campaign's calls on
// them hidden. Restore is service-role only (no org-facing undo). See
// supabase/migrations/20260623000001_campaign_soft_delete.sql.
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
    .select("id, organisation_id, status, deleted_at")
    .eq("id", parsed.data.id)
    .maybeSingle<{
      id: string;
      organisation_id: string;
      status: string;
      deleted_at: string | null;
    }>();
  // A row that's already soft-deleted reads as "not found" to the org.
  if (!existing || existing.deleted_at) return fail("Campaign not found");
  if (!(await userOwnsOrg(supabase, user.id, existing.organisation_id))) {
    return fail("Forbidden");
  }

  // Stop an active run first so the dispatcher can't dial mid-delete: skip any
  // still-pending contacts and flip the campaign out of a running state. The
  // RPC then stamps the whole footprint (incl. these) under one batch id.
  if (existing.status === "in_progress" || existing.status === "scheduled") {
    await admin
      .from("campaign_contacts")
      .update({ status: "skipped" })
      .eq("campaign_id", existing.id)
      .eq("status", "pending");
    await admin
      .from("campaigns")
      .update({ status: "stopped", completed_at: new Date().toISOString() })
      .eq("id", existing.id);
  }

  // Atomic soft delete (service-role-only RPC). Verified ownership above.
  const { error } = await admin.rpc("soft_delete_campaign", {
    p_campaign_id: existing.id,
    p_user_id: user.id,
  });
  if (error) {
    return fail(
      logSkeloError("CAMPAIGN", "Soft delete failed", {
        organisationId: existing.organisation_id,
        cause: error,
      }),
    );
  }

  revalidatePath("/campaigns");
  return ok({ id: existing.id });
}

export async function listCampaigns(
  input: unknown,
): Promise<ActionResult<{ items: CampaignListItem[]; total: number }>> {
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

  const campaigns = data ?? [];
  const bestByCampaign = await loadCampaignBestDispositions(
    supabase,
    parsed.data.organisation_id,
    campaigns.map((c) => c.id),
  );
  const items: CampaignListItem[] = campaigns.map((c) => ({
    ...c,
    best_disposition: bestByCampaign.get(c.id) ?? null,
  }));

  return ok({ items, total: count ?? 0 });
}

// Resolve the single highest-priority disposition reached by any contact in
// each campaign. One policy read + one aggregate RPC per page; the RPC returns
// the small distinct (campaign, outcome) set and we rank it here so reordering
// outcomes can never leave a stale value behind.
async function loadCampaignBestDispositions(
  supabase: SupabaseServerClient,
  organisationId: string,
  campaignIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (campaignIds.length === 0) return result;

  const ranking = await loadOutcomeRanking(supabase, organisationId);
  if (ranking.size === 0) return result;

  const { data, error } = await supabase.rpc("campaign_best_dispositions", {
    p_org_id: organisationId,
    p_campaign_ids: campaignIds,
  });
  if (error) return result;
  const rows: { campaign_id: string; outcome_key: string }[] = Array.isArray(
    data,
  )
    ? data
    : [];

  const occurredByCampaign = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = occurredByCampaign.get(row.campaign_id) ?? new Set<string>();
    set.add(row.outcome_key);
    occurredByCampaign.set(row.campaign_id, set);
  }
  for (const [campaignId, keys] of occurredByCampaign) {
    const best = pickBestOutcome(keys, ranking);
    if (best) result.set(campaignId, best);
  }
  return result;
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

// Fetch a single campaign by id, org-scoped. Powers the detail page header.
export async function getCampaign(
  input: unknown,
): Promise<ActionResult<Campaign>> {
  const parsed = campaignIdSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid id");

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("campaigns")
    .select(CAMPAIGN_COLUMNS)
    .eq("id", parsed.data.id)
    // This read uses the admin client (bypasses RLS), so exclude soft-deleted
    // campaigns explicitly — a bookmarked detail URL must 404 after deletion.
    .is("deleted_at", null)
    .maybeSingle<Campaign>();
  if (error) return fail(error.message);
  if (!data) return fail("Campaign not found");
  if (!(await userOwnsOrg(supabase, user.id, data.organisation_id))) {
    return fail("Forbidden");
  }
  return ok(data);
}

export interface CampaignStats {
  // Contact-level funnel.
  totalContacts: number;
  attemptedContacts: number; // contacts with at least one dial
  connectedContacts: number; // contacts whose latest outcome is completed
  succeededContacts: number; // contact.status = 'succeeded'
  failedContacts: number; // contact.status = 'failed'
  pendingContacts: number; // still pending / in flight
  connectRatePct: number; // connected / attempted
  successRatePct: number; // succeeded / total
  avgAttemptsPerContact: number;
  // Call-level outcomes (every dial, all attempts).
  totalCalls: number;
  outcomes: Array<{ status: CallStatus; count: number }>;
  // Talk time (seconds). Cost isn't tracked on calls, so it's omitted.
  totalTalkSeconds: number;
  avgTalkSeconds: number; // over connected calls
  longestTalkSeconds: number;
  // Dials per day across the run (YYYY-MM-DD → count), ascending.
  callsPerDay: Array<{ date: string; count: number }>;
  // Per caller-ID breakdown so operators can see how switching spread the load
  // and which numbers are healthy. `recentConnectRatePct` is measured over the
  // campaign's switch window; `isResting` means it's below the floor (with
  // enough samples) — i.e. the dispatcher is steering away from it.
  switchFloorPct: number;
  switchWindowMinutes: number;
  // True when every number with enough recent samples is resting — the run is
  // dialing from degraded numbers (least-bad fallback).
  degraded: boolean;
  byNumber: Array<{
    phone: string;
    label: string;
    totalCalls: number;
    connected: number;
    connectRatePct: number; // lifetime
    recentDials: number; // dials within the switch window
    recentConnectRatePct: number | null; // null until enough samples
    isResting: boolean;
  }>;
  // Per-contact "why is it here" view. Counts are always exact (every contact);
  // `contacts` is capped (most-actionable first) so the payload stays bounded.
  contactStateCounts: Record<ContactState, number>;
  contacts: ContactRow[];
  contactsOverflow: number; // contacts not in the capped list above
}

// Where a single contact sits in the dial lifecycle, with the actionable
// pending sub-states broken out so an operator can see WHY it hasn't dialed.
export type ContactState =
  | "succeeded"
  | "failed"
  | "dialing" // in_flight right now
  | "deferred" // pending — every caller-ID resting (backoff)
  | "callback" // pending — customer-requested callback scheduled
  | "retry" // pending — waiting on the retry interval after a no-answer/busy
  | "queued"; // pending — never dialed yet

export interface ContactRow {
  id: string;
  name: string | null;
  phone: string;
  state: ContactState;
  detail: string; // short human reason, no timestamp
  attempt: number;
  maxAttempts: number;
  nextAttemptAt: string | null; // ISO (drives sort)
  // Compact "in 24m" / "in 2h" / "in 6d" label, computed at fetch time so the
  // render stays pure. Null unless the contact is waiting for a next dial.
  nextAttemptLabel: string | null;
}

// Compact, timezone-agnostic "how long until" label.
function formatUntil(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return "due now";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `in ${hrs}h`;
  return `in ${Math.round(hrs / 24)}d`;
}

// States that are actively waiting for a next dial — only these show a time.
const WAITING_STATES: ReadonlySet<ContactState> = new Set<ContactState>([
  "deferred",
  "callback",
  "retry",
]);

// Order the contact list so the operator sees the contacts that need attention
// first. Lower = higher priority.
const CONTACT_STATE_RANK: Record<ContactState, number> = {
  deferred: 0,
  callback: 1,
  retry: 2,
  dialing: 3,
  queued: 4,
  failed: 5,
  succeeded: 6,
};

// How many contact rows we ship to the UI. Counts cover everyone; the list is
// capped so a 50k-contact campaign doesn't serialise a giant payload.
const CONTACT_LIST_CAP = 200;

// Pure mapping from a contact's columns to its lifecycle state + a short reason.
// A `completed` last_status that is back in `pending` can only be a callback
// re-arm (the disposition tier is the lone path that re-pends a connected call).
function deriveContactState(c: {
  status: string;
  attempt: number;
  last_status: string | null;
  last_outcome: string | null;
  last_error: string | null;
  health_defer_count: number;
  callback_count: number;
}): { state: ContactState; detail: string } {
  if (c.status === "succeeded") {
    return {
      state: "succeeded",
      detail: c.last_outcome ? `Outcome: ${c.last_outcome}` : "Completed",
    };
  }
  if (c.status === "failed") {
    return {
      state: "failed",
      detail: c.last_error ?? c.last_status ?? "Failed",
    };
  }
  if (c.status === "in_flight") {
    return { state: "dialing", detail: "Dialing now" };
  }
  // status === 'pending' from here — explain which kind of wait it is.
  if (c.health_defer_count > 0) {
    return {
      state: "deferred",
      detail: "All caller IDs resting (low connect rate)",
    };
  }
  if (c.callback_count > 0 && c.last_status === "completed") {
    return { state: "callback", detail: "Customer-requested callback" };
  }
  if (c.attempt > 0) {
    return {
      state: "retry",
      detail: c.last_status ? `Retrying after ${c.last_status}` : "Retrying",
    };
  }
  return { state: "queued", detail: "Waiting to be dialled" };
}

const ALL_CALL_STATUSES: CallStatus[] = [
  "completed",
  "no_answer",
  "busy",
  "failed",
  "canceled",
  "in_progress",
  "ringing",
  "initiated",
];

export async function getCampaignStats(
  input: unknown,
): Promise<ActionResult<CampaignStats>> {
  const parsed = campaignIdSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid id");

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");

  const admin = createAdminClient();
  const { data: campaign } = await admin
    .from("campaigns")
    .select(
      "id, organisation_id, max_attempts, switch_connect_rate_floor, switch_window_minutes, switch_min_samples",
    )
    .eq("id", parsed.data.id)
    .maybeSingle<{
      id: string;
      organisation_id: string;
      max_attempts: number;
      switch_connect_rate_floor: number;
      switch_window_minutes: number;
      switch_min_samples: number;
    }>();
  if (!campaign) return fail("Campaign not found");
  if (!(await userOwnsOrg(supabase, user.id, campaign.organisation_id))) {
    return fail("Forbidden");
  }

  // Caller-ID labels for the per-number breakdown.
  const { data: integration } = await admin
    .from("bolna_integrations")
    .select("from_phone_labels")
    .eq("organisation_id", campaign.organisation_id)
    .maybeSingle<{
      from_phone_labels: Record<string, unknown> | null;
    }>();
  const numberLabels = integration?.from_phone_labels ?? {};
  const switchFloorPct = campaign.switch_connect_rate_floor;
  const switchWindowMinutes = campaign.switch_window_minutes;
  const switchMinSamples = campaign.switch_min_samples;

  // Org outcome policy → which outcomes count toward the success rate. The
  // metric is decoupled from the contact's terminal state: an org may mark a
  // fail-action outcome as "counts". Fallback covers any key not in the policy.
  const { data: policyRows } = await admin
    .from("org_outcome_policies")
    .select("outcome_key, counts_as_success, is_fallback")
    .eq("organisation_id", campaign.organisation_id)
    .returns<
      { outcome_key: string; counts_as_success: boolean; is_fallback: boolean }[]
    >();
  const successByKey = new Map<string, boolean>();
  // Pre-config default: a connected call with no disposition was a success.
  let fallbackSuccess = true;
  for (const r of policyRows ?? []) {
    successByKey.set(r.outcome_key, r.counts_as_success);
    if (r.is_fallback) fallbackSuccess = r.counts_as_success;
  }

  // Contacts (small per campaign — bounded by CSV upload). We pull the pacing
  // columns too so we can explain WHY each contact is where it is (deferred /
  // callback-scheduled / waiting on a retry) — the campaign's transparency view.
  const { data: contacts, error: cErr } = await admin
    .from("campaign_contacts")
    .select(
      "id, name, phone, status, attempt, last_status, last_outcome, last_error, next_attempt_at, health_defer_count, callback_count",
    )
    .eq("campaign_id", campaign.id)
    .returns<
      Array<{
        id: string;
        name: string | null;
        phone: string;
        status: string;
        attempt: number;
        last_status: string | null;
        last_outcome: string | null;
        last_error: string | null;
        next_attempt_at: string | null;
        health_defer_count: number;
        callback_count: number;
      }>
    >();
  if (cErr) return fail(cErr.message);

  const totalContacts = contacts?.length ?? 0;
  let attemptedContacts = 0;
  let connectedContacts = 0;
  let succeededContacts = 0;
  let failedContacts = 0;
  let pendingContacts = 0;
  let attemptSum = 0;
  const contactStateCounts: Record<ContactState, number> = {
    succeeded: 0,
    failed: 0,
    dialing: 0,
    deferred: 0,
    callback: 0,
    retry: 0,
    queued: 0,
  };
  const allContactRows: ContactRow[] = [];
  const nowMs = Date.now();
  for (const c of contacts ?? []) {
    attemptSum += c.attempt;
    if (c.attempt > 0) attemptedContacts += 1;
    // "Success" is policy-driven but GATED on the call having connected, so a
    // never-connected contact can't count as a success via the fallback, and
    // the funnel stays monotonic (succeeded ⊆ connected).
    if (c.last_status === "completed") {
      connectedContacts += 1;
      const key = c.last_outcome ?? FALLBACK_OUTCOME_KEY;
      if (successByKey.get(key) ?? fallbackSuccess) succeededContacts += 1;
    }
    if (c.status === "failed") failedContacts += 1;
    else if (c.status === "pending" || c.status === "in_flight")
      pendingContacts += 1;

    const { state, detail } = deriveContactState(c);
    contactStateCounts[state] += 1;
    allContactRows.push({
      id: c.id,
      name: c.name,
      phone: c.phone,
      state,
      detail,
      attempt: c.attempt,
      maxAttempts: campaign.max_attempts,
      nextAttemptAt: c.next_attempt_at,
      nextAttemptLabel: WAITING_STATES.has(state)
        ? formatUntil(c.next_attempt_at, nowMs)
        : null,
    });
  }
  // Most-actionable first (deferred → callback → retry → …), then cap.
  allContactRows.sort(
    (a, b) =>
      CONTACT_STATE_RANK[a.state] - CONTACT_STATE_RANK[b.state] ||
      // Within a state, soonest next attempt first (nulls last).
      (a.nextAttemptAt ?? "9").localeCompare(b.nextAttemptAt ?? "9"),
  );
  const contactRows = allContactRows.slice(0, CONTACT_LIST_CAP);
  const contactsOverflow = Math.max(0, totalContacts - contactRows.length);

  // Calls (every dial). Bounded by attempts × contacts; fine to pull for
  // aggregation. Exclude test rows defensively (campaign calls never are).
  const ids = (contacts ?? []).map((c) => c.id);
  const calls = ids.length
    ? (
        await admin
          .from("calls")
          .select("status, duration_seconds, started_at, from_phone")
          .in("campaign_contact_id", ids)
          .eq("is_test", false)
          .returns<
            Array<{
              status: CallStatus;
              duration_seconds: number | null;
              started_at: string;
              from_phone: string | null;
            }>
          >()
      ).data ?? []
    : [];

  const outcomeCounts = new Map<CallStatus, number>();
  const perDay = new Map<string, number>();
  // Per caller-ID tallies: lifetime (total/connected) + recent window
  // (recentDials/recentConnects) for the health/switching view.
  const numberAgg = new Map<
    string,
    { total: number; connected: number; recentDials: number; recentConnects: number }
  >();
  const windowCutoff = Date.now() - switchWindowMinutes * 60 * 1000;
  let totalTalkSeconds = 0;
  let connectedCalls = 0;
  let longestTalkSeconds = 0;
  for (const call of calls) {
    outcomeCounts.set(call.status, (outcomeCounts.get(call.status) ?? 0) + 1);
    const day = call.started_at.slice(0, 10);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
    if (call.from_phone) {
      const agg = numberAgg.get(call.from_phone) ?? {
        total: 0,
        connected: 0,
        recentDials: 0,
        recentConnects: 0,
      };
      agg.total += 1;
      if (call.status === "completed") agg.connected += 1;
      // Mirror the dispatcher: only RESOLVED calls inform the recent connect
      // rate. Counting in-flight dials here would mislabel a number as
      // "resting" right after a burst (same bug the dispatcher avoids).
      if (
        new Date(call.started_at).getTime() >= windowCutoff &&
        RESOLVED_CALL_STATUSES.has(call.status)
      ) {
        agg.recentDials += 1;
        if (call.status === "completed") agg.recentConnects += 1;
      }
      numberAgg.set(call.from_phone, agg);
    }
    if (call.status === "completed") {
      const d = call.duration_seconds ?? 0;
      totalTalkSeconds += d;
      connectedCalls += 1;
      if (d > longestTalkSeconds) longestTalkSeconds = d;
    }
  }

  const outcomes = ALL_CALL_STATUSES.map((status) => ({
    status,
    count: outcomeCounts.get(status) ?? 0,
  })).filter((o) => o.count > 0);

  const callsPerDay = Array.from(perDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  const pct = (num: number, den: number) =>
    den > 0 ? Math.round((num / den) * 1000) / 10 : 0;

  const labelFor = (phone: string): string => {
    const raw = numberLabels[phone];
    return typeof raw === "string" && raw.trim() ? raw : phone;
  };
  const byNumber = Array.from(numberAgg.entries())
    .map(([phone, agg]) => {
      // Recent connect rate is only trustworthy with enough samples in the
      // window — below that we show null and never mark the number resting
      // (mirrors the dispatcher's min-samples gate).
      const enoughSamples = agg.recentDials >= switchMinSamples;
      const recentRate = enoughSamples
        ? pct(agg.recentConnects, agg.recentDials)
        : null;
      return {
        phone,
        label: labelFor(phone),
        totalCalls: agg.total,
        connected: agg.connected,
        connectRatePct: pct(agg.connected, agg.total),
        recentDials: agg.recentDials,
        recentConnectRatePct: recentRate,
        isResting: recentRate !== null && recentRate < switchFloorPct,
      };
    })
    .sort((a, b) => b.totalCalls - a.totalCalls);

  // Degraded = at least one number has enough recent samples to judge and ALL
  // such numbers are resting (the dispatcher is in least-bad fallback).
  const judged = byNumber.filter((n) => n.recentConnectRatePct !== null);
  const degraded = judged.length > 0 && judged.every((n) => n.isResting);

  return ok({
    totalContacts,
    attemptedContacts,
    connectedContacts,
    succeededContacts,
    failedContacts,
    pendingContacts,
    connectRatePct: pct(connectedContacts, attemptedContacts),
    successRatePct: pct(succeededContacts, totalContacts),
    avgAttemptsPerContact:
      totalContacts > 0
        ? Math.round((attemptSum / totalContacts) * 10) / 10
        : 0,
    totalCalls: calls.length,
    outcomes,
    totalTalkSeconds,
    avgTalkSeconds:
      connectedCalls > 0 ? Math.round(totalTalkSeconds / connectedCalls) : 0,
    longestTalkSeconds,
    callsPerDay,
    switchFloorPct,
    switchWindowMinutes,
    degraded,
    byNumber,
    contactStateCounts,
    contacts: contactRows,
    contactsOverflow,
  });
}

export interface OutcomeFilterOption {
  key: string; // the normalised call_outcome stored on calls
  label: string; // human label from the org's policy
}

/**
 * Outcome keys + labels configured for an org (from `org_outcome_policies`),
 * used to populate the campaign Calls filter. Read with the user's own
 * (RLS-scoped) client after an explicit ownership check — no admin client
 * needed, and it never leaks another tenant's vocabulary.
 */
export async function listCampaignOutcomeOptions(
  organisationId: string,
): Promise<ActionResult<OutcomeFilterOption[]>> {
  if (!organisationId) return fail("Missing organisation id");

  const { supabase, user } = await requireUser();
  if (!user) return fail("Not authenticated");
  if (!(await userOwnsOrg(supabase, user.id, organisationId))) {
    return fail("Forbidden");
  }

  const { data, error } = await supabase
    .from("org_outcome_policies")
    .select("outcome_key, label, position")
    .eq("organisation_id", organisationId)
    .order("position", { ascending: true })
    .returns<{ outcome_key: string; label: string; position: number }[]>();
  if (error) return fail(error.message);

  return ok(
    (data ?? []).map((r) => ({ key: r.outcome_key, label: r.label })),
  );
}
