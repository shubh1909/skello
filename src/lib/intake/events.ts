import "server-only";

import { warnSkelo } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import type { IntakeSourceRow } from "@/lib/intake/source";
import type { LeadIntakeEventStatus } from "@/types/lead-intake";

/**
 * The intake event ledger.
 *
 * Every delivery is written here BEFORE the webhook acks. That ordering is the
 * whole point: an ack tells the sender to forget the delivery, and everything
 * that runs after it runs somewhere the sender can no longer hear us fail. Same
 * discipline as `recordCheckoutEvent` on the Shopify path.
 */

export type RecordOutcome =
  | { kind: "recorded"; eventId: string }
  | { kind: "duplicate" }
  | { kind: "error"; cause: unknown };

/**
 * Insert the receipt.
 *
 * A unique violation on `(source_id, external_id)` is a REDELIVERY, not a
 * failure: Google says outright that a `lead_id` may arrive more than once, and
 * Meta redelivers on any non-2xx. The caller turns this into a 200 and does no
 * further work.
 *
 * Returns an `error` outcome rather than throwing so the caller can decide the
 * status code — and for Google that decision matters, because a 200 on a failed
 * write loses the lead permanently.
 */
export async function recordIntakeEvent(args: {
  source: IntakeSourceRow;
  externalId: string | null;
  payload: unknown;
  status?: LeadIntakeEventStatus;
}): Promise<RecordOutcome> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("lead_intake_events")
    .insert({
      organisation_id: args.source.organisation_id,
      source_id: args.source.id,
      channel: args.source.channel,
      external_id: args.externalId,
      status: args.status ?? "received",
      payload: args.payload as never,
    })
    .select("id")
    .single<{ id: string }>();

  if (!error && data) return { kind: "recorded", eventId: data.id };
  if (error?.code === "23505") return { kind: "duplicate" };
  return { kind: "error", cause: error };
}

/**
 * Close out an event once ingest has finished (or failed).
 *
 * Best-effort: the lead is already written by this point, and failing the
 * webhook over a bookkeeping update would ask the sender to redeliver a lead we
 * successfully took. The row stays `received`, which reads as "started, never
 * confirmed" — the honest description of what happened.
 */
export async function settleIntakeEvent(args: {
  eventId: string;
  status: LeadIntakeEventStatus;
  leadId?: string | null;
  error?: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("lead_intake_events")
    .update({
      status: args.status,
      lead_id: args.leadId ?? null,
      error: args.error ?? null,
      processed_at: new Date().toISOString(),
    })
    .eq("id", args.eventId);

  if (error) {
    warnSkelo("WEBHOOK-INGEST", "Could not settle intake event", {
      eventId: args.eventId,
      status: args.status,
      cause: error,
    });
  }
}
