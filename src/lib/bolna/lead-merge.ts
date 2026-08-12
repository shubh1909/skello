import "server-only";

import type {
  BolnaField,
  BolnaLeadPayload,
} from "@/lib/bolna/extract";
import { extractLead, pickValue } from "@/lib/bolna/extract";
import { warnSkelo } from "@/lib/errors";
// The channel-neutral half of ingest. Extracted so Google Ads / portal / CTWA
// intake extends this logic instead of growing a second copy of it.
import {
  applyJsonbSnapshot,
  findOrCreateLead,
  getLockedFields,
  registerDiscoveredFields,
} from "@/lib/leads/ingest";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CallOutcome } from "@/types/call";
import type { LeadIntent } from "@/types/lead";

const VALID_INTENTS: readonly LeadIntent[] = ["hot", "warm", "cold"];

function coerceIntent(raw: string | null): LeadIntent | null {
  if (!raw) return null;
  const match = VALID_INTENTS.find((v) => v === raw.trim().toLowerCase());
  return match ?? null;
}

/**
 * The agent's 0-100 intent score, or null.
 *
 * Out-of-range and non-numeric values are DROPPED rather than clamped. The DB
 * has the same 0-100 CHECK, so clamping would only be a way of storing a number
 * the model never said — and an agent emitting "high" or 250 is a prompt that
 * needs fixing, not a value worth rescuing. Fractions round: a score is a rank,
 * and 56.4 ranks where 56 does.
 */
function coerceIntentScore(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 0 || rounded > 100) return null;
  return rounded;
}

// Keys we promote to first-class columns on `calls` (and propagate to the
// "current view" columns on `leads` via the merge). Everything ELSE in the
// extracted payload lands in custom_data with category=''.
const FIRST_CLASS_LEAD_DATA_KEYS = new Set([
  "name",
  "interest",
  "lead_intent",
  "intent_score",
  "actionable",
  "customer_status",
  "connect_on_whatsapp",
  "date_and_time_of_visit",
  "business_slug",
  "call_outcome",
  "callback_at",
]);

// Lead-row fields the admin can lock via lead_field_overrides. The merge
// consults the lock list and skips writing any locked field, but still
// records the value on the call snapshot (immutable record of what the LLM
// said on that conversation).
const OVERRIDEABLE_LEAD_FIELDS = [
  "name",
  "current_intent",
  "current_intent_score",
  "city",
  "pincode",
  // JSONB paths checked with the same field_path string the override uses.
] as const;

export interface MergeResult {
  leadId: string;
  created: boolean;
  callSnapshot: {
    lead_data: Record<string, unknown>;
    custom_data: Record<string, Record<string, unknown>>;
    name_extracted: string | null;
    interest: string | null;
    lead_intent_extracted: LeadIntent | null;
    intent_score_extracted: number | null;
    actionable: string | null;
    customer_status: string | null;
    visit_scheduled_at: string | null;
    connect_on_whatsapp: boolean | null;
    call_outcome: CallOutcome | null;
    requested_callback_at: string | null;
  };
}

interface MergeArgs {
  organisationId: string;
  phoneRaw: string | null;
  payload: BolnaLeadPayload;
  source: "inbound_call" | "manual";
}

// Builds the per-call snapshot blobs from the provider's raw extracted_data.
// This is the immutable record of "what the LLM said on this conversation".
// It feeds the merge into leads AND lives on the calls row forever.
//
// extracted_data is keyed by category. `lead_data` is special: its keys are
// split between first-class lead columns (FIRST_CLASS_LEAD_DATA_KEYS) and
// the uncategorised custom_data bucket (custom_data['']). Every other
// top-level key is treated as a custom_data category — its keys land in
// custom_data[<category>] verbatim.
function buildSnapshot(
  extractedData:
    | Record<string, Record<string, BolnaField> | undefined>
    | null
    | undefined,
): MergeResult["callSnapshot"] {
  const emptySnapshot: MergeResult["callSnapshot"] = {
    lead_data: {},
    custom_data: {},
    name_extracted: null,
    interest: null,
    lead_intent_extracted: null,
    intent_score_extracted: null,
    actionable: null,
    customer_status: null,
    visit_scheduled_at: null,
    connect_on_whatsapp: null,
    call_outcome: null,
    requested_callback_at: null,
  };
  if (!extractedData) return emptySnapshot;

  const leadData = extractedData.lead_data ?? {};
  const extracted = extractLead(leadData);
  const leadDataBlob: Record<string, unknown> = {};
  const customDataBlob: Record<string, Record<string, unknown>> = {};

  // lead_data category — split into first-class columns + uncategorised bag.
  for (const [key, field] of Object.entries(leadData)) {
    const value = pickValue(field);
    if (value === null) continue;
    if (FIRST_CLASS_LEAD_DATA_KEYS.has(key)) {
      leadDataBlob[key] = value;
    } else {
      (customDataBlob[""] ??= {})[key] = value;
    }
  }

  // Every other category — dump verbatim into custom_data[<category>].
  // Defensive: only process entries that look like a BolnaField record so a
  // stray scalar at the extracted_data level (or a category we've already
  // handled via lead_data) doesn't poison the snapshot.
  for (const [category, fields] of Object.entries(extractedData)) {
    if (category === "lead_data") continue;
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) continue;
    for (const [key, field] of Object.entries(fields)) {
      const value = pickValue(field as BolnaField);
      if (value === null) continue;
      (customDataBlob[category] ??= {})[key] = value;
    }
  }

  return {
    lead_data: leadDataBlob,
    custom_data: customDataBlob,
    name_extracted: extracted.name,
    interest: extracted.interest,
    lead_intent_extracted: coerceIntent(extracted.lead_intent),
    intent_score_extracted: coerceIntentScore(extracted.intent_score),
    actionable: extracted.actionable,
    customer_status: extracted.customer_status,
    visit_scheduled_at: extracted.visit_scheduled_at,
    connect_on_whatsapp: extracted.connect_on_whatsapp,
    call_outcome: extracted.call_outcome,
    requested_callback_at: extracted.requested_callback_at,
  };
}

// Merge the call snapshot onto the lead row using "latest non-null wins",
// gated by the override lock list. Touches:
//   - first-class lead columns (name, current_intent, city, pincode)
//   - lead_data jsonb (per-key merge via jsonb_set)
//   - custom_data jsonb (per-category, per-key merge)
//   - last_contact_at = now()
async function mergeOntoLead(args: {
  organisationId: string;
  leadId: string;
  snapshot: MergeResult["callSnapshot"];
}): Promise<void> {
  const admin = createAdminClient();
  const locked = await getLockedFields(args.leadId);

  // First-class columns from the snapshot.
  const colPatch: Record<string, unknown> = {
    last_contact_at: new Date().toISOString(),
  };
  if (
    args.snapshot.name_extracted &&
    !locked.has("name")
  ) {
    colPatch.name = args.snapshot.name_extracted;
  }
  if (
    args.snapshot.lead_intent_extracted &&
    !locked.has("current_intent")
  ) {
    colPatch.current_intent = args.snapshot.lead_intent_extracted;
  }
  // `!== null` rather than truthiness: 0 is a real score — the coldest one —
  // and the truthy test that reads fine for the intent band would silently
  // refuse to record it.
  if (
    args.snapshot.intent_score_extracted !== null &&
    !locked.has("current_intent_score")
  ) {
    colPatch.current_intent_score = args.snapshot.intent_score_extracted;
  }

  const { error: colErr } = await admin
    .from("leads")
    .update(colPatch)
    .eq("id", args.leadId)
    .eq("organisation_id", args.organisationId);
  if (colErr) {
    warnSkelo("LEAD-MERGE-FAIL", "Column patch failed (partial merge)", {
      organisationId: args.organisationId,
      leadId: args.leadId,
      cause: colErr,
    });
  }

  // The per-key JSONB merge is identical for every source, so it lives in
  // lib/leads/ingest.ts. The column patch above is what stays here: only a
  // conversation produces an intent band and a score.
  await applyJsonbSnapshot({
    organisationId: args.organisationId,
    leadId: args.leadId,
    snapshot: {
      lead_data: args.snapshot.lead_data,
      custom_data: args.snapshot.custom_data,
    },
    locked,
  });
}

// Public entry point — used by both inbound and outbound webhook ingest.
// Find-or-create the lead, build the per-call snapshot, merge onto the
// lead (override-aware), auto-register discovered fields. Returns the lead
// id and the snapshot for the caller to write onto the calls row.
export async function mergePayloadIntoLead(
  args: MergeArgs,
): Promise<MergeResult> {
  const { leadId, created } = await findOrCreateLead({
    organisationId: args.organisationId,
    phoneRaw: args.phoneRaw,
    source: args.source,
  });
  const snapshot = buildSnapshot(args.payload.extracted_data);

  // Run merge and discovery in parallel — they're independent.
  await Promise.all([
    mergeOntoLead({
      organisationId: args.organisationId,
      leadId,
      snapshot,
    }),
    registerDiscoveredFields(args.organisationId, {
      lead_data: snapshot.lead_data,
      custom_data: snapshot.custom_data,
    }),
  ]);

  return { leadId, created, callSnapshot: snapshot };
}
