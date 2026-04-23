import { z } from "zod";

const bolnaFieldSchema = z
  .object({
    subjective: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
    objective: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
    confidence: z.number().optional(),
    confidence_label: z.string().optional(),
  })
  .passthrough();

export const bolnaLeadPayloadSchema = z
  .object({
    extracted_data: z.object({
      lead_data: z.record(z.string(), bolnaFieldSchema),
    }),
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
  product: string | null;
  customer_status: string | null;
  lead_intent: string | null;
  connect_on_whatsapp: boolean | null;
  visit_scheduled_at: string | null;
  confidence: Record<string, number>;
}

export function extractLead(payload: BolnaLeadPayload): ExtractedLead {
  const ld = payload.extracted_data.lead_data;

  const confidence: Record<string, number> = {};
  for (const [key, field] of Object.entries(ld)) {
    if (typeof field?.confidence === "number") confidence[key] = field.confidence;
  }

  return {
    business_slug: pickValue(ld.business_slug),
    name: pickValue(ld.name),
    product: pickValue(ld.product),
    customer_status: pickValue(ld.customer_status),
    lead_intent: pickValue(ld.lead_intent),
    connect_on_whatsapp: toBoolean(pickValue(ld.connect_on_whatsapp)),
    visit_scheduled_at: toTimestamp(pickValue(ld.date_and_time_of_visit)),
    confidence,
  };
}
