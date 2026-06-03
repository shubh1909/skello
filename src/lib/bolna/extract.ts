import { z } from "zod";

// Per-field caps bound the work the webhook does on a single payload. Bolna's
// real-world values are well under these; the limits exist so a leaked webhook
// secret or a buggy provider payload can't push multi-MB strings into the DB.
const REASONING_MAX = 5_000;

const bolnaFieldSchema = z
  .object({
    subjective: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
    objective: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
    // Bolna leaves the per-side reasoning string `null` when only the
    // opposite side was filled, so both reasoning fields must accept null.
    reasoning_subjective: z.string().max(REASONING_MAX).nullish(),
    reasoning_objective: z.string().max(REASONING_MAX).nullish(),
    confidence: z.number().nullish(),
    confidence_label: z.string().max(200).nullish(),
    validation: z.unknown().nullish(),
  })
  .passthrough();

// Bolna fires the webhook three times per call (in-progress → disconnected →
// completed). Only the final event has `extracted_data` populated; the first
// two send it as `null`. The schema must accept the missing case so we can
// short-circuit them with a 200 instead of failing validation with a 400.
//
// extracted_data carries `lead_data` (the canonical, first-class category)
// plus any number of additional category buckets — e.g. extra_data, finance,
// vehicle. The catchall captures every other top-level key under
// extracted_data without enumerating it; each one must still be a record of
// BolnaField entries so the merge pipeline can rely on the shape.
export const bolnaLeadPayloadSchema = z
  .object({
    extracted_data: z
      .object({
        lead_data: z.record(z.string(), bolnaFieldSchema),
      })
      .catchall(z.record(z.string(), bolnaFieldSchema))
      .nullable()
      .optional(),
    status: z.string().nullish(),
    user_number: z.string().nullish(),
    agent_number: z.string().nullish(),
    transcript: z.string().nullish(),
    summary: z.string().nullish(),
    agent_id: z.string().nullish(),
    conversation_duration: z.number().nullish(),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
    initiated_at: z.string().nullish(),
    total_cost: z.number().nullish(),
    error_message: z.string().nullish(),
    telephony_data: z
      .object({
        to_number: z.string().nullish(),
        from_number: z.string().nullish(),
        recording_url: z.string().nullish(),
        call_type: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

export type BolnaField = z.infer<typeof bolnaFieldSchema>;
export type BolnaLeadPayload = z.infer<typeof bolnaLeadPayloadSchema>;

/**
 * Bolna returns each field with both `subjective` and `objective` candidates.
 * Prefer subjective; fall back to objective. Treat empty strings as absent.
 */
export function pickValue(field: BolnaField | undefined): string | null {
  if (!field) return null;
  const s = field.subjective;
  if (s !== null && s !== undefined && String(s).trim() !== "") return String(s);
  const o = field.objective;
  if (o !== null && o !== undefined && String(o).trim() !== "") return String(o);
  return null;
}

export function toBoolean(v: string | null): boolean | null {
  if (v === null) return null;
  const lower = v.toLowerCase().trim();
  if (["true", "yes", "1"].includes(lower)) return true;
  if (["false", "no", "0"].includes(lower)) return false;
  return null;
}

export function toTimestamp(v: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export interface ExtractedLead {
  business_slug: string | null;
  name: string | null;
  interest: string | null;
  customer_status: string | null;
  lead_intent: string | null;
  actionable: string | null;
  connect_on_whatsapp: boolean | null;
  visit_scheduled_at: string | null;
  confidence: Record<string, number>;
  summary: string | null;
}

export function extractLead(
  leadData: Record<string, BolnaField>,
): ExtractedLead {
  const ld = leadData;

  const confidence: Record<string, number> = {};
  for (const [key, field] of Object.entries(ld)) {
    if (typeof field?.confidence === "number") confidence[key] = field.confidence;
  }

  // `interest` is read straight from the agent's `interest` key. We no
  // longer alias the legacy `product` key onto it — every key is captured
  // as-is (a stray `product` flows through to custom_data via the generic
  // path), so consolidating two keys into one column here only hid where
  // the data actually came from. Keep keys separate; let admins promote.
  return {
    business_slug: pickValue(ld.business_slug),
    name: pickValue(ld.name),
    interest: pickValue(ld.interest),
    customer_status: pickValue(ld.customer_status),
    lead_intent: pickValue(ld.lead_intent),
    actionable: pickValue(ld.actionable),
    connect_on_whatsapp: toBoolean(pickValue(ld.connect_on_whatsapp)),
    visit_scheduled_at: toTimestamp(pickValue(ld.date_and_time_of_visit)),
    confidence,
    summary: buildSummary(ld),
  };
}

// Bolna emits a `reasoning_subjective` string on each `lead_data` field
// describing why the model chose that value. We concatenate these into a
// single human-readable summary keyed by field label.
const SUMMARY_MAX = 10_000;

export function buildSummary(
  leadData: Record<string, BolnaField>,
): string | null {
  const parts: string[] = [];
  for (const [key, field] of Object.entries(leadData)) {
    const reasoning = field?.reasoning_subjective?.trim();
    if (!reasoning) continue;
    parts.push(`${humaniseFieldKey(key)}: ${reasoning}`);
  }
  if (parts.length === 0) return null;
  const joined = parts.join("\n\n");
  return joined.length > SUMMARY_MAX ? joined.slice(0, SUMMARY_MAX) : joined;
}

function humaniseFieldKey(key: string): string {
  return key
    .split("_")
    .map((word) => (word.length === 0 ? word : word[0].toUpperCase() + word.slice(1)))
    .join(" ");
}
