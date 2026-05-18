import "server-only";

import type {
  BolnaField,
  BolnaLeadPayload,
} from "@/lib/bolna/extract";
import { extractLead, pickValue } from "@/lib/bolna/extract";
import { logSkeloError, warnSkelo } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  LeadFieldDataType,
  LeadFieldSource,
} from "@/types/lead-field-definition";
import type { LeadIntent } from "@/types/lead";

const VALID_INTENTS: readonly LeadIntent[] = ["hot", "warm", "cold"];

function coerceIntent(raw: string | null): LeadIntent | null {
  if (!raw) return null;
  const match = VALID_INTENTS.find((v) => v === raw.trim().toLowerCase());
  return match ?? null;
}

// Keys we promote to first-class columns on `calls` (and propagate to the
// "current view" columns on `leads` via the merge). Everything ELSE in the
// extracted payload lands in custom_data with category=''.
const FIRST_CLASS_LEAD_DATA_KEYS = new Set([
  "name",
  "interest",
  "product",
  "lead_intent",
  "actionable",
  "customer_status",
  "connect_on_whatsapp",
  "date_and_time_of_visit",
  "business_slug",
]);

// Lead-row fields the admin can lock via lead_field_overrides. The merge
// consults the lock list and skips writing any locked field, but still
// records the value on the call snapshot (immutable record of what the LLM
// said on that conversation).
const OVERRIDEABLE_LEAD_FIELDS = [
  "name",
  "current_intent",
  "city",
  "pincode",
  // JSONB paths checked with the same field_path string the override uses.
] as const;

function inferDataType(value: unknown): LeadFieldDataType {
  if (value === null || value === undefined) return "unknown";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "string";
    // ISO date heuristic.
    if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(trimmed)) {
      return "date";
    }
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return "number";
    if (["true", "false", "yes", "no"].includes(trimmed.toLowerCase())) return "boolean";
    return "string";
  }
  return "unknown";
}

export interface MergeResult {
  leadId: string;
  created: boolean;
  callSnapshot: {
    lead_data: Record<string, unknown>;
    custom_data: Record<string, Record<string, unknown>>;
    name_extracted: string | null;
    interest: string | null;
    lead_intent_extracted: LeadIntent | null;
    actionable: string | null;
    customer_status: string | null;
    visit_scheduled_at: string | null;
    connect_on_whatsapp: boolean | null;
  };
}

interface MergeArgs {
  organisationId: string;
  phoneRaw: string | null;
  payload: BolnaLeadPayload;
  source: "inbound_call" | "manual";
}

// Builds the per-call snapshot blobs from the provider's raw lead_data.
// This is the immutable record of "what the LLM said on this conversation".
// It feeds the merge into leads AND lives on the calls row forever.
function buildSnapshot(
  leadData: Record<string, BolnaField> | undefined,
): MergeResult["callSnapshot"] {
  if (!leadData) {
    return {
      lead_data: {},
      custom_data: {},
      name_extracted: null,
      interest: null,
      lead_intent_extracted: null,
      actionable: null,
      customer_status: null,
      visit_scheduled_at: null,
      connect_on_whatsapp: null,
    };
  }

  const extracted = extractLead(leadData);
  const leadDataBlob: Record<string, unknown> = {};
  const customDataBlob: Record<string, Record<string, unknown>> = {};

  for (const [key, field] of Object.entries(leadData)) {
    const value = pickValue(field);
    if (value === null) continue;
    if (FIRST_CLASS_LEAD_DATA_KEYS.has(key)) {
      leadDataBlob[key] = value;
    } else {
      customDataBlob[""] ??= {};
      customDataBlob[""][key] = value;
    }
  }

  return {
    lead_data: leadDataBlob,
    custom_data: customDataBlob,
    name_extracted: extracted.name,
    interest: extracted.interest,
    lead_intent_extracted: coerceIntent(extracted.lead_intent),
    actionable: extracted.actionable,
    customer_status: extracted.customer_status,
    visit_scheduled_at: extracted.visit_scheduled_at,
    connect_on_whatsapp: extracted.connect_on_whatsapp,
  };
}

// Normalize a phone number to digits-only. Mirrors the SQL expression on
// leads.phone_normalized so the lookup matches the generated column.
function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  return digits.length === 0 ? null : digits;
}

// Find-or-create the lead for (org, phone). The unique index on
// (organisation_id, phone_normalized) means concurrent inserts from two
// webhooks for the same number collapse to one row via the conflict path.
async function findOrCreateLead(
  organisationId: string,
  phoneRaw: string | null,
  source: MergeArgs["source"],
): Promise<{ leadId: string; created: boolean }> {
  const admin = createAdminClient();
  const phoneNorm = normalizePhone(phoneRaw);

  if (phoneNorm) {
    const { data: existing } = await admin
      .from("leads")
      .select("id")
      .eq("organisation_id", organisationId)
      .eq("phone_normalized", phoneNorm)
      .maybeSingle<{ id: string }>();
    if (existing) return { leadId: existing.id, created: false };
  }

  // Resolve the org slug for the convenience column (kept until cleanup).
  const { data: org } = await admin
    .from("organisations")
    .select("slug")
    .eq("id", organisationId)
    .maybeSingle<{ slug: string }>();

  const now = new Date().toISOString();
  const { data: created, error } = await admin
    .from("leads")
    .insert({
      organisation_id: organisationId,
      org_slug: org?.slug ?? null,
      phone: phoneRaw ?? null,
      source,
      status: "new",
      first_seen_at: now,
      last_contact_at: now,
    })
    .select("id")
    .single<{ id: string }>();

  if (!error && created) return { leadId: created.id, created: true };

  // Lost the race — another webhook just created this lead. Refetch by the
  // unique key and continue.
  if (error?.code === "23505" && phoneNorm) {
    const { data: raced } = await admin
      .from("leads")
      .select("id")
      .eq("organisation_id", organisationId)
      .eq("phone_normalized", phoneNorm)
      .maybeSingle<{ id: string }>();
    if (raced) return { leadId: raced.id, created: false };
  }

  const tagged = logSkeloError("LEAD-LOOKUP-FAIL", "Lead find-or-create failed", {
    organisationId,
    phoneNormalized: phoneNorm,
    cause: error,
  });
  throw new Error(tagged);
}

// Pulls the currently-locked field paths from lead_field_overrides via the
// lead_locked_fields RPC. Returns a Set for O(1) lookup during the merge.
async function getLockedFields(leadId: string): Promise<Set<string>> {
  const admin = createAdminClient();
  const { data } = await admin.rpc("lead_locked_fields", { p_lead_id: leadId });
  const rows = Array.isArray(data) ? data : [];
  return new Set(rows.map((r: { field_path: string }) => r.field_path));
}

// Registers every discovered key in lead_field_definitions for the org so
// admins can promote them to visible columns later. Idempotent — replays
// just bump last_seen_at + refresh sample_value.
async function registerDiscoveredFields(
  organisationId: string,
  snapshot: MergeResult["callSnapshot"],
): Promise<void> {
  const admin = createAdminClient();
  // Supabase's RPC builder is thenable but not a true Promise — accept
  // PromiseLike here so `Promise.allSettled` below can iterate it.
  const calls: Array<PromiseLike<unknown>> = [];

  const enqueue = (
    source: LeadFieldSource,
    category: string,
    key: string,
    value: unknown,
  ) => {
    calls.push(
      admin.rpc("register_lead_field", {
        p_org_id: organisationId,
        p_source: source,
        p_category: category,
        p_key_path: key,
        p_sample_value: value as never,
        p_data_type: inferDataType(value),
      }),
    );
  };

  for (const [key, value] of Object.entries(snapshot.lead_data)) {
    enqueue("lead_data", "", key, value);
  }
  for (const [category, bag] of Object.entries(snapshot.custom_data)) {
    for (const [key, value] of Object.entries(bag)) {
      enqueue("custom_data", category, key, value);
    }
  }

  // Run in parallel but tolerate individual failures — auto-discovery is
  // best-effort observability, not a correctness gate.
  const results = await Promise.allSettled(calls);
  for (const r of results) {
    if (r.status === "rejected") {
      warnSkelo("FIELD-DEF-WRITE-FAIL", "Auto-discovery upsert failed", {
        organisationId,
        cause: r.reason,
      });
    }
  }
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

  for (const [key, value] of Object.entries(args.snapshot.lead_data)) {
    const path = `lead_data.${key}`;
    if (locked.has(path)) continue;
    const { error } = await admin.rpc("apply_lead_field_jsonb", {
      p_lead_id: args.leadId,
      p_org_id: args.organisationId,
      p_column: "lead_data",
      p_path: [key],
      p_value: value as never,
    });
    if (error) {
      warnSkelo("LEAD-MERGE-FAIL", "lead_data jsonb merge failed (partial)", {
        organisationId: args.organisationId,
        leadId: args.leadId,
        fieldPath: path,
        cause: error,
      });
    }
  }

  for (const [category, bag] of Object.entries(args.snapshot.custom_data)) {
    for (const [key, value] of Object.entries(bag)) {
      const path = `custom_data.${category}.${key}`;
      if (locked.has(path)) continue;
      const { error } = await admin.rpc("apply_lead_field_jsonb", {
        p_lead_id: args.leadId,
        p_org_id: args.organisationId,
        p_column: "custom_data",
        p_path: category === "" ? [key] : [category, key],
        p_value: value as never,
      });
      if (error) {
        warnSkelo("LEAD-MERGE-FAIL", "custom_data jsonb merge failed (partial)", {
          organisationId: args.organisationId,
          leadId: args.leadId,
          fieldPath: path,
          cause: error,
        });
      }
    }
  }
}

// Public entry point — used by both inbound and outbound webhook ingest.
// Find-or-create the lead, build the per-call snapshot, merge onto the
// lead (override-aware), auto-register discovered fields. Returns the lead
// id and the snapshot for the caller to write onto the calls row.
export async function mergePayloadIntoLead(
  args: MergeArgs,
): Promise<MergeResult> {
  const { leadId, created } = await findOrCreateLead(
    args.organisationId,
    args.phoneRaw,
    args.source,
  );
  const snapshot = buildSnapshot(args.payload.extracted_data?.lead_data);

  // Run merge and discovery in parallel — they're independent.
  await Promise.all([
    mergeOntoLead({
      organisationId: args.organisationId,
      leadId,
      snapshot,
    }),
    registerDiscoveredFields(args.organisationId, snapshot),
  ]);

  return { leadId, created, callSnapshot: snapshot };
}
