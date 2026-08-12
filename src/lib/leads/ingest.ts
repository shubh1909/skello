import "server-only";

import { logSkeloError, warnSkelo } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  LeadFieldDataType,
  LeadFieldSource,
} from "@/types/lead-field-definition";
import type { LeadSource } from "@/types/lead";

/**
 * The channel-neutral core of lead ingest.
 *
 * Every source — a voice call, a Google Ads form, a portal enquiry — ends in the
 * same four steps: find-or-create by phone, honour the admin's field locks, merge
 * the JSONB, register anything new in the field catalog. That logic was written
 * once for the voice path (`lib/bolna/lead-merge.ts`) and is correct; it lives
 * here so the other channels EXTEND it rather than growing a second copy that
 * drifts.
 *
 * `lead-merge.ts` keeps everything genuinely provider-specific: parsing the
 * provider's `extracted_data` shape, the intent/score coercions, and the
 * first-class column patch that only a conversation can produce.
 */

/**
 * The two JSONB blobs every source ultimately writes.
 *
 * `custom_data` is keyed by category; `""` is the canonical uncategorised bucket
 * (what `apply_lead_field_jsonb` writes). See `lib/csv-custom-fields.ts` for the
 * two legacy aliases still in the wild.
 */
export interface IngestSnapshot {
  lead_data: Record<string, unknown>;
  custom_data: Record<string, Record<string, unknown>>;
}

/**
 * What a channel adapter produces. Deliberately small: anything a channel knows
 * that doesn't map onto a lead column belongs in the snapshot, where it becomes
 * a registered field and therefore bindable on the lead sheet.
 */
export interface NormalisedLead {
  phone: string | null;
  name: string | null;
  city: string | null;
  pincode: string | null;
  source: LeadSource;
  snapshot: IngestSnapshot;
}

/**
 * Digits-only. Mirrors the SQL expression behind `leads.phone_normalized` so a
 * lookup matches the generated column.
 *
 * ⚠️ This is ONE of three deliberately different normalisations in the repo —
 * recovery attribution uses the last 10 digits, dialling uses E.164. Don't
 * unify them; see the `skelo-leads` skill.
 */
export function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  return digits.length === 0 ? null : digits;
}

export function inferDataType(value: unknown): LeadFieldDataType {
  if (value === null || value === undefined) return "unknown";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "string";
    // ISO date heuristic.
    if (
      /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(
        trimmed,
      )
    ) {
      return "date";
    }
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return "number";
    if (["true", "false", "yes", "no"].includes(trimmed.toLowerCase())) {
      return "boolean";
    }
    return "string";
  }
  return "unknown";
}

/**
 * Find-or-create the lead for (org, phone).
 *
 * The unique index on `(organisation_id, phone_normalized)` is PARTIAL on
 * `deleted_at is null`, so: soft-deleted leads are skipped on lookup (a new
 * interaction gets a fresh visible lead, not a hidden one), and only a live row
 * can collide on insert — which is what makes the 23505 refetch correct.
 *
 * A null phone still creates a lead. Some sources are legitimately phone-less
 * (a Google form that only asked for an email); redelivery is guarded upstream
 * by the event ledger's `external_id`, not by phone dedupe.
 */
export async function findOrCreateLead(args: {
  organisationId: string;
  phoneRaw: string | null;
  source: LeadSource;
  /** Columns to set only on INSERT. Never overwrites an existing lead. */
  seed?: Record<string, unknown>;
}): Promise<{ leadId: string; created: boolean }> {
  const admin = createAdminClient();
  const phoneNorm = normalizePhone(args.phoneRaw);

  if (phoneNorm) {
    const { data: existing } = await admin
      .from("leads")
      .select("id")
      .eq("organisation_id", args.organisationId)
      .eq("phone_normalized", phoneNorm)
      .is("deleted_at", null)
      .maybeSingle<{ id: string }>();
    if (existing) return { leadId: existing.id, created: false };
  }

  // Resolve the org slug for the legacy convenience column. `leads` is
  // dual-keyed and the slug-based RLS policy is still live, so a row inserted
  // without org_slug is invisible to it.
  const { data: org } = await admin
    .from("organisations")
    .select("slug")
    .eq("id", args.organisationId)
    .maybeSingle<{ slug: string }>();

  const now = new Date().toISOString();
  const { data: created, error } = await admin
    .from("leads")
    .insert({
      ...(args.seed ?? {}),
      organisation_id: args.organisationId,
      org_slug: org?.slug ?? null,
      phone: args.phoneRaw ?? null,
      source: args.source,
      status: "new",
      first_seen_at: now,
      last_contact_at: now,
    })
    .select("id")
    .single<{ id: string }>();

  if (!error && created) return { leadId: created.id, created: true };

  // Lost the race — another delivery just created this lead. Refetch by the
  // unique key and continue.
  if (error?.code === "23505" && phoneNorm) {
    const { data: raced } = await admin
      .from("leads")
      .select("id")
      .eq("organisation_id", args.organisationId)
      .eq("phone_normalized", phoneNorm)
      .is("deleted_at", null)
      .maybeSingle<{ id: string }>();
    if (raced) return { leadId: raced.id, created: false };
  }

  const tagged = logSkeloError("LEAD-LOOKUP-FAIL", "Lead find-or-create failed", {
    organisationId: args.organisationId,
    phoneNormalized: phoneNorm,
    cause: error,
  });
  throw new Error(tagged);
}

/**
 * Field paths an admin has pinned via `lead_field_overrides`.
 *
 * Returned as a Set for O(1) lookup during the merge. A locked path is skipped
 * on write but still recorded on any per-interaction snapshot — the lock says
 * "don't change the lead", not "pretend it wasn't said".
 */
export async function getLockedFields(leadId: string): Promise<Set<string>> {
  const admin = createAdminClient();
  const { data } = await admin.rpc("lead_locked_fields", { p_lead_id: leadId });
  const rows = Array.isArray(data) ? data : [];
  return new Set(rows.map((r: { field_path: string }) => r.field_path));
}

/**
 * Merge the snapshot's two JSONB blobs onto the lead, key by key.
 *
 * Per-key via the `apply_lead_field_jsonb` RPC rather than one column write:
 * two sources touching the same lead concurrently must not clobber each other's
 * keys, and a whole-object update would.
 *
 * Failures are warned, not thrown — a partial merge is better than a rejected
 * lead, and the raw payload is retained by the caller for replay.
 */
export async function applyJsonbSnapshot(args: {
  organisationId: string;
  leadId: string;
  snapshot: IngestSnapshot;
  locked: Set<string>;
}): Promise<void> {
  const admin = createAdminClient();

  for (const [key, value] of Object.entries(args.snapshot.lead_data)) {
    if (args.locked.has(`lead_data.${key}`)) continue;
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
        fieldPath: `lead_data.${key}`,
        cause: error,
      });
    }
  }

  for (const [category, bag] of Object.entries(args.snapshot.custom_data)) {
    for (const [key, value] of Object.entries(bag)) {
      if (args.locked.has(`custom_data.${category}.${key}`)) continue;
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
          fieldPath: `custom_data.${category}.${key}`,
          cause: error,
        });
      }
    }
  }
}

/**
 * Upsert every key we just saw into `lead_field_definitions`.
 *
 * This is what makes a new channel free at the UI layer: a 99acres "budget" or a
 * Google custom question lands in the catalog on first sight, which makes it
 * selectable as a leads-table column AND bindable to a lead-sheet card without
 * anyone writing a line of display code.
 *
 * Idempotent — replays bump `last_seen_at` and refresh the sample. Best-effort:
 * discovery is observability, not a correctness gate, so individual failures are
 * warned and the ingest continues.
 */
export async function registerDiscoveredFields(
  organisationId: string,
  snapshot: IngestSnapshot,
): Promise<void> {
  const admin = createAdminClient();
  // Supabase's RPC builder is thenable but not a true Promise — accept
  // PromiseLike so `Promise.allSettled` below can iterate it.
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

/**
 * The entry point for every non-voice channel.
 *
 * Find-or-create, patch the handful of columns a form can fill, merge the JSONB,
 * register the fields. The voice path does NOT come through here — it needs a
 * per-call snapshot on `calls` and an intent/score column patch that only a
 * conversation produces (see `mergePayloadIntoLead`).
 *
 * **`source` is first-touch.** It is written on insert and never on update, so a
 * lead that first arrived from a call and later fills in a Google form keeps
 * `inbound_call`. The later touch is still visible — it lands in `custom_data`
 * and in the intake event ledger — but the attribution column doesn't flip under
 * whoever contacted them most recently.
 */
export interface IngestOptions {
  /**
   * May this source overwrite a name already on the lead? Default true.
   *
   * WhatsApp passes false: the only name it has is the sender's WhatsApp
   * display name, which is user-chosen and frequently a shop name or an emoji
   * string. Letting that replace a name a salesperson heard on a call would be
   * a straight regression.
   */
  overwriteName?: boolean;
  /**
   * Reopen a `won`/`lost` lead back to `new` when they get in touch again.
   *
   * On for channels where the contact is unambiguously the person reaching out
   * (an ad tap, a form submission). A closed lead responding to a new campaign
   * is a new opportunity, and leaving them filed under "lost" hides them from
   * every pipeline view.
   */
  reopenClosedStatus?: boolean;
}

/** Statuses a re-engagement reopens. In-flight ones are left alone. */
const CLOSED_STATUSES = new Set(["won", "lost"]);

export async function ingestNormalisedLead(args: {
  organisationId: string;
  lead: NormalisedLead;
  options?: IngestOptions;
}): Promise<{ leadId: string; created: boolean; reopened: boolean }> {
  const { leadId, created } = await findOrCreateLead({
    organisationId: args.organisationId,
    phoneRaw: args.lead.phone,
    source: args.lead.source,
    seed: {
      ...(args.lead.name ? { name: args.lead.name } : {}),
      ...(args.lead.city ? { city: args.lead.city } : {}),
      ...(args.lead.pincode ? { pincode: args.lead.pincode } : {}),
    },
  });

  const locked = await getLockedFields(leadId);
  const admin = createAdminClient();

  // Latest-non-null-wins on the columns a form can fill, gated by the same lock
  // list the voice merge uses. `created` rows already carry these from the seed;
  // re-writing them is a no-op rather than a special case.
  const colPatch: Record<string, unknown> = {
    last_contact_at: new Date().toISOString(),
  };
  const mayWriteName = args.options?.overwriteName !== false;
  if (args.lead.name && mayWriteName && !locked.has("name")) {
    colPatch.name = args.lead.name;
  }
  if (args.lead.city && !locked.has("city")) colPatch.city = args.lead.city;
  if (args.lead.pincode && !locked.has("pincode")) {
    colPatch.pincode = args.lead.pincode;
  }

  // A freshly created lead is already `new`, so the extra read only happens for
  // someone who was closed and has come back.
  let reopened = false;
  if (args.options?.reopenClosedStatus && !created) {
    const { data: current } = await admin
      .from("leads")
      .select("status")
      .eq("id", leadId)
      .eq("organisation_id", args.organisationId)
      .maybeSingle<{ status: string | null }>();
    if (current?.status && CLOSED_STATUSES.has(current.status)) {
      colPatch.status = "new";
      reopened = true;
    }
  }

  const { error: colErr } = await admin
    .from("leads")
    .update(colPatch)
    .eq("id", leadId)
    .eq("organisation_id", args.organisationId);
  if (colErr) {
    warnSkelo("LEAD-MERGE-FAIL", "Column patch failed (partial ingest)", {
      organisationId: args.organisationId,
      leadId,
      cause: colErr,
    });
  }

  await Promise.all([
    applyJsonbSnapshot({
      organisationId: args.organisationId,
      leadId,
      snapshot: args.lead.snapshot,
      locked,
    }),
    registerDiscoveredFields(args.organisationId, args.lead.snapshot),
  ]);

  return { leadId, created, reopened };
}

/**
 * Is there already a live lead for this phone?
 *
 * The "first-time sender" test for WhatsApp: a plain inbound message from
 * someone we've never heard of becomes a lead, one from a known customer does
 * not. `deleted_at IS NULL` matters — a soft-deleted lead is not a live one, and
 * the dedupe index is partial for exactly that reason.
 */
export async function leadExistsForPhone(
  organisationId: string,
  phoneRaw: string | null,
): Promise<boolean> {
  const phoneNorm = normalizePhone(phoneRaw);
  if (!phoneNorm) return false;

  const admin = createAdminClient();
  const { data } = await admin
    .from("leads")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("phone_normalized", phoneNorm)
    .is("deleted_at", null)
    .maybeSingle<{ id: string }>();
  return Boolean(data);
}
