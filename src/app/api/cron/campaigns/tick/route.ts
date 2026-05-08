import { NextResponse, type NextRequest } from "next/server";

import { BolnaApiError, initiateBolnaCall } from "@/lib/bolna/client";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Drained per tick. Bolna API throughput is the binding constraint, not
// Postgres — keep batches small so one big campaign can't starve others.
const BATCH_LIMIT = 25;
const PER_CAMPAIGN_LIMIT = 10;

interface DueContact {
  id: string;
  campaign_id: string;
  organisation_id: string;
  phone: string;
  name: string | null;
  metadata: Record<string, unknown>;
  attempt: number;
  campaign: {
    id: string;
    organisation_id: string;
    status: string;
    max_attempts: number;
  } | null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return unauthorized();
  const headerSecret = request.headers.get("x-cron-secret");
  if (!headerSecret || !timingSafeEqual(headerSecret, expected)) {
    return unauthorized();
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  // Flip any 'scheduled' campaigns whose start time has arrived.
  await admin
    .from("campaigns")
    .update({ status: "in_progress", started_at: nowIso })
    .eq("status", "scheduled")
    .lte("scheduled_at", nowIso);

  // Pull due contacts whose parent campaign is currently running. The
  // joined campaign row gives us max_attempts + status without a second
  // round trip per contact.
  const { data, error } = await admin
    .from("campaign_contacts")
    .select(
      "id, campaign_id, organisation_id, phone, name, metadata, attempt, campaign:campaigns!campaign_id(id, organisation_id, status, max_attempts)",
    )
    .eq("status", "pending")
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(BATCH_LIMIT * 2)
    .returns<DueContact[]>();

  if (error) {
    console.error("[campaigns cron] fetch failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Cap per campaign for fairness, then take the global head.
  const perCampaign = new Map<string, number>();
  const queue: DueContact[] = [];
  for (const c of data ?? []) {
    if (!c.campaign || c.campaign.status !== "in_progress") continue;
    if (c.attempt >= c.campaign.max_attempts) continue;
    const used = perCampaign.get(c.campaign_id) ?? 0;
    if (used >= PER_CAMPAIGN_LIMIT) continue;
    perCampaign.set(c.campaign_id, used + 1);
    queue.push(c);
    if (queue.length >= BATCH_LIMIT) break;
  }

  if (queue.length === 0) {
    return NextResponse.json({ processed: 0, fired: 0 }, { status: 200 });
  }

  // Cache integrations per org — usually just one org per tick.
  const orgIds = Array.from(new Set(queue.map((c) => c.organisation_id)));
  const { data: integrations } = await admin
    .from("bolna_integrations")
    .select("organisation_id, agent_id, api_key, from_phone_number, enabled")
    .in("organisation_id", orgIds)
    .returns<
      Array<{
        organisation_id: string;
        agent_id: string;
        api_key: string;
        from_phone_number: string | null;
        enabled: boolean;
      }>
    >();
  const integrationByOrg = new Map(
    (integrations ?? []).map((i) => [i.organisation_id, i] as const),
  );

  // Optimistically claim each contact ('pending' -> 'in_flight') so a second
  // overlapping tick can't pick the same row. The .eq('status','pending')
  // guard makes this a CAS.
  const fired = await Promise.allSettled(
    queue.map(async (contact) => {
      const integration = integrationByOrg.get(contact.organisation_id);
      if (!integration || !integration.enabled) {
        await admin
          .from("campaign_contacts")
          .update({
            status: "failed",
            attempt: contact.attempt + 1,
            last_error: "Voice agent not configured",
          })
          .eq("id", contact.id);
        return { id: contact.id, ok: false, reason: "no_integration" };
      }

      const { data: claim } = await admin
        .from("campaign_contacts")
        .update({ status: "in_flight" })
        .eq("id", contact.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle<{ id: string }>();
      if (!claim) {
        return { id: contact.id, ok: false, reason: "lost_claim" };
      }

      try {
        const result = await initiateBolnaCall({
          apiKey: integration.api_key,
          agentId: integration.agent_id,
          recipientPhone: contact.phone,
          fromPhone: integration.from_phone_number,
          metadata: {
            organisation_id: contact.organisation_id,
            campaign_id: contact.campaign_id,
            campaign_contact_id: contact.id,
            contact_name: contact.name,
            ...contact.metadata,
          },
        });

        const { data: callRow, error: callErr } = await admin
          .from("calls")
          .insert({
            organisation_id: contact.organisation_id,
            campaign_contact_id: contact.id,
            bolna_call_id: result.bolnaCallId,
            direction: "outbound",
            to_phone: contact.phone,
            from_phone: integration.from_phone_number,
            agent_id: integration.agent_id,
            status: "initiated",
          })
          .select("id")
          .single<{ id: string }>();

        if (callErr || !callRow) {
          await admin
            .from("campaign_contacts")
            .update({
              status: "pending",
              attempt: contact.attempt + 1,
              last_error: callErr?.message ?? "Call insert failed",
              next_attempt_at: new Date(
                Date.now() + 60_000,
              ).toISOString(),
            })
            .eq("id", contact.id);
          return { id: contact.id, ok: false, reason: "call_insert" };
        }

        await admin
          .from("campaign_contacts")
          .update({
            attempt: contact.attempt + 1,
            last_call_id: callRow.id,
            last_error: null,
          })
          .eq("id", contact.id);

        return { id: contact.id, ok: true };
      } catch (err) {
        const reason =
          err instanceof BolnaApiError
            ? err.message
            : "Failed to reach the voice provider";

        // Provider-level failure: log a failed call row for visibility, then
        // either re-arm for another retry or mark the contact failed if the
        // attempt cap is now hit.
        await admin.from("calls").insert({
          organisation_id: contact.organisation_id,
          campaign_contact_id: contact.id,
          to_phone: contact.phone,
          from_phone: integration.from_phone_number,
          agent_id: integration.agent_id,
          status: "failed",
          direction: "outbound",
          error_message: reason.slice(0, 500),
        });

        const newAttempt = contact.attempt + 1;
        const cap = contact.campaign?.max_attempts ?? 1;
        if (newAttempt >= cap) {
          await admin
            .from("campaign_contacts")
            .update({
              status: "failed",
              attempt: newAttempt,
              last_status: "failed",
              last_error: reason.slice(0, 500),
            })
            .eq("id", contact.id);
        } else {
          // Use the campaign's configured interval; we read it lazily here
          // because the join above didn't include it.
          const { data: cfg } = await admin
            .from("campaigns")
            .select("retry_interval_seconds")
            .eq("id", contact.campaign_id)
            .maybeSingle<{ retry_interval_seconds: number }>();
          const intervalSec = cfg?.retry_interval_seconds ?? 900;
          await admin
            .from("campaign_contacts")
            .update({
              status: "pending",
              attempt: newAttempt,
              last_status: "failed",
              last_error: reason.slice(0, 500),
              next_attempt_at: new Date(
                Date.now() + intervalSec * 1000,
              ).toISOString(),
            })
            .eq("id", contact.id);
        }
        return { id: contact.id, ok: false, reason: "bolna_error" };
      }
    }),
  );

  const okCount = fired.filter(
    (r) => r.status === "fulfilled" && r.value.ok,
  ).length;

  return NextResponse.json(
    {
      processed: queue.length,
      fired: okCount,
    },
    { status: 200 },
  );
}
