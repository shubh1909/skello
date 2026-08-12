"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth/session";
import { warnSkelo } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  assignCallbackSchema,
  cancelCallbackSchema,
  listLeadCallbacksSchema,
} from "@/lib/validations/callback";
import { type ActionResult, fail, ok } from "@/types/action";

/** The slice of a queued callback the lead sheet shows. */
export interface LeadCallback {
  id: string;
  status: "pending" | "in_flight" | "succeeded" | "failed" | "canceled";
  scheduled_at: string;
  attempt: number;
  max_attempts: number;
  origin: "inbound_outcome" | "manual";
  last_error: string | null;
}

const COLUMNS =
  "id, status, scheduled_at, attempt, max_attempts, origin, last_error";

/**
 * Callbacks queued for one lead, newest first.
 *
 * Cookie client: `scheduled_callbacks` has a SELECT policy for org owners, so
 * RLS scopes this. The explicit organisation_id filter is still the primary
 * gate (Law #1).
 */
export async function listLeadCallbacks(
  input: unknown,
): Promise<ActionResult<LeadCallback[]>> {
  const parsed = listLeadCallbacksSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const session = await requireSession();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("scheduled_callbacks")
    .select(COLUMNS)
    .eq("organisation_id", session.organisation.id)
    .eq("lead_id", parsed.data.lead_id)
    .is("deleted_at", null)
    .order("scheduled_at", { ascending: false })
    .limit(parsed.data.limit)
    .returns<LeadCallback[]>();

  if (error) return fail(error.message);
  return ok(data ?? []);
}

/**
 * Queue an automated callback for this lead — the sheet's "Assign callback".
 *
 * The agent does the dialling: this writes a `scheduled_callbacks` row that the
 * existing cron drainer picks up, rather than creating a human reminder. The
 * table anticipated this exact caller — `origin` has always allowed 'manual'
 * and `created_by` has always existed; both were unused until now.
 *
 * WRITES GO THROUGH THE ADMIN CLIENT because scheduled_callbacks has no
 * authenticated INSERT policy (same posture as voice_agents). That bypasses RLS
 * *and* soft-delete filtering, so every read below scopes by hand.
 */
export async function assignCallback(
  input: unknown,
): Promise<ActionResult<{ id: string; scheduled_at: string }>> {
  const parsed = assignCallbackSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const session = await requireSession();
  const orgId = session.organisation.id;
  const admin = createAdminClient();

  // Admin client — the org filter and deleted_at are ours to enforce.
  const { data: lead } = await admin
    .from("leads")
    .select("id, phone")
    .eq("id", parsed.data.lead_id)
    .eq("organisation_id", orgId)
    .is("deleted_at", null)
    .maybeSingle<{ id: string; phone: string | null }>();
  if (!lead) return fail("Lead not found");

  const phone = lead.phone?.trim() ?? "";
  // Matches the column's CHECK. Failing here gives the user a sentence; failing
  // in Postgres gives them a constraint name.
  if (phone.length < 5) return fail("This lead has no phone number to call");

  const { data: cfg } = await admin
    .from("bolna_integrations")
    .select(
      "agent_id, from_phone_number, enabled, callback_agent_id, callback_from_phone",
    )
    .eq("organisation_id", orgId)
    .maybeSingle<{
      agent_id: string | null;
      from_phone_number: string | null;
      enabled: boolean;
      callback_agent_id: string | null;
      callback_from_phone: string | null;
    }>();

  if (!cfg) return fail("Voice agent isn't configured for this workspace");
  if (!cfg.enabled) return fail("Voice agent is switched off for this workspace");

  // Same resolution order as the automatic path in lib/callbacks/schedule.ts:
  // the dedicated callback agent, else the integration's default.
  //
  // Deliberately NOT gated on `callbacks_enabled`. That flag governs whether an
  // inbound call's outcome may queue a callback on its own; a person clicking
  // "Assign callback" has already made that decision themselves.
  const agentId = cfg.callback_agent_id?.trim() || cfg.agent_id?.trim() || null;
  if (!agentId) return fail("No voice agent is set up to place callbacks");
  const fromPhone =
    cfg.callback_from_phone?.trim() || cfg.from_phone_number?.trim() || null;

  const whenIso = parsed.data.scheduled_at;
  if (new Date(whenIso).getTime() <= Date.now()) {
    return fail("Pick a time in the future");
  }

  const { data, error } = await admin
    .from("scheduled_callbacks")
    .insert({
      organisation_id: orgId,
      lead_id: lead.id,
      // No source call: this callback was assigned by a human, not derived
      // from a conversation. The idempotency index is partial on
      // source_call_id, so a null here is exempt from it — two clicks queue
      // two callbacks, which is what "assign another one" should do.
      source_call_id: null,
      phone,
      agent_id: agentId,
      from_phone: fromPhone,
      status: "pending",
      scheduled_at: whenIso,
      next_attempt_at: whenIso,
      origin: "manual",
      created_by: session.userId,
    })
    .select("id, scheduled_at")
    .single<{ id: string; scheduled_at: string }>();

  if (error) {
    // Same tag as the automatic path: one search finds every failure to queue
    // a callback, whoever asked for it.
    warnSkelo("CALLBACK-SCHEDULE", "Failed to queue manual callback", {
      organisationId: orgId,
      cause: error,
    });
    return fail(error.message);
  }

  revalidatePath("/leads");
  return ok(data);
}

/** Cancel a callback that hasn't been dialled yet. */
export async function cancelCallback(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = cancelCallbackSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const session = await requireSession();
  const admin = createAdminClient();

  // `status = 'pending'` in the WHERE, not just a pre-check: the drainer may
  // flip the row to in_flight between our read and our write, and cancelling a
  // call that is already ringing is a lie to whoever is watching.
  const { data, error } = await admin
    .from("scheduled_callbacks")
    .update({ status: "canceled" })
    .eq("id", parsed.data.id)
    .eq("organisation_id", session.organisation.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) return fail(error.message);
  if (!data) return fail("That callback is no longer pending");

  revalidatePath("/leads");
  return ok({ id: data.id });
}
