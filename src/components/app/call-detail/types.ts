import type { CallTranscriptStatus } from "@/types/call";

/**
 * The shape the shared call rail and pane read.
 *
 * Deliberately **structural, with the widest field types**, rather than a view
 * model with an adapter per caller. `Call` (the lead sheet) and
 * `RecoveryCallRow` (cart recovery, COD) both satisfy this as-is:
 *
 * - `status` / `direction` are enums on `Call` and plain strings on
 *   `RecoveryCallRow`; `string` accepts both, and the badge maps already fall
 *   back gracefully on an unknown value.
 * - `custom_data` is `Record<string, Record<string, unknown>>` on `Call` and
 *   `Record<string, unknown> | null` on `RecoveryCallRow`; the wider one accepts
 *   both, and the renderer skips any value that isn't a bag.
 *
 * Two mapping functions would have to be kept in sync forever, and the first
 * time they drifted the two surfaces would silently disagree about the same
 * call. A structural type makes that impossible: add a field here and both
 * callers either already have it or fail to compile.
 */
export interface CallPaneCall {
  id: string;
  status: string;
  direction: string;
  from_phone: string | null;
  to_phone: string | null;

  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;

  recording_url: string | null;
  transcript: string | null;
  transcript_url: string | null;
  transcript_status: CallTranscriptStatus;

  summary: string | null;
  actionable: string | null;

  /** Why a dial never happened. Only the recovery/COD queries select these. */
  error_message?: string | null;
  bolna_call_id?: string | null;

  // Per-conversation extraction snapshots.
  name_extracted: string | null;
  interest: string | null;
  lead_intent_extracted: string | null;
  customer_status: string | null;
  call_outcome: string | null;
  requested_callback_at: string | null;
  visit_scheduled_at: string | null;
  connect_on_whatsapp: boolean | null;

  lead_data: Record<string, unknown> | null;
  custom_data: Record<string, unknown> | null;

  /**
   * The linked lead's **current** record, as opposed to what this one call
   * extracted.
   *
   * Optional, and that is what decides where the Lead panel appears. `Call`
   * (the lead sheet) doesn't carry these, so the panel is absent there — which
   * is right, because you are already inside that lead's sheet and repeating
   * their name back at you is noise. `RecoveryCallRow` and `CodCallRow` do
   * carry them, because on those surfaces a call is the only thing on screen
   * and "who is this?" is otherwise unanswerable.
   *
   * Names match `RecoveryCallRow`'s existing columns so the recovery rows
   * satisfy this with no mapping.
   */
  lead_name?: string | null;
  lead_status?: string | null;
  lead_intent?: string | null;
}
