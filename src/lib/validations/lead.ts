import { z } from "zod";

export const leadIdSchema = z.string().uuid("Invalid lead id");

export const leadIntentSchema = z.enum(["hot", "warm", "cold"]);

export const leadSourceSchema = z.enum([
  "inbound_call",
  "whatsapp",
  "manual",
  "import",
  "web_form",
]);

export const leadStatusSchema = z.enum([
  "new",
  "contacted",
  "qualified",
  "negotiating",
  "won",
  "lost",
]);

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const orgSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(63)
  .regex(slugRegex, "Slug must be lowercase, numbers and hyphens only");

// Create: only fields that live on the leads row post-remodel, plus the
// dynamic fields the form chooses to seed. Per-call fields (summary,
// actionable, recording_url) are no longer settable at the lead level —
// they belong to individual calls.
export const leadCreateSchema = z.object({
  org_slug: orgSlugSchema,
  name: z.string().trim().min(1).max(200).nullish(),
  phone: z.string().trim().max(32).nullish(),
  current_intent: leadIntentSchema.nullish(),
  // Back-compat: callers passing `lead_intent` continue to work.
  lead_intent: leadIntentSchema.nullish(),
  source: leadSourceSchema.nullish(),
  status: leadStatusSchema.optional(),
  notes: z.string().trim().max(5000).nullish(),
  city: z.string().trim().max(100).nullish(),
  pincode: z.string().trim().max(20).nullish(),
  // Dynamic-field seeds — get written into lead_data on create.
  interest: z.string().trim().max(500).nullish(),
  customer_status: z.string().trim().max(50).nullish(),
  wants_to_connect_on_watsapp: z.boolean().nullish(),
  visit_date_time: z.string().datetime({ offset: true }).nullish(),
});

// Bag of JSONB-friendly scalars accepted for catalog-driven field patches.
// JSONB tolerates more, but constraining the type surface keeps the API
// predictable and prevents accidental nested objects landing in a "string"
// catalog slot.
const jsonScalarSchema = z.union([
  z.string().max(2000),
  z.number(),
  z.boolean(),
  z.null(),
]);

const fieldKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9_\-.]+$/, "Invalid field key");

const categoryKeySchema = z
  .string()
  .trim()
  .max(120)
  .regex(/^[a-zA-Z0-9_\-.]*$/, "Invalid category");

export const leadUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).nullish(),
    phone: z.string().trim().max(32).nullish(),
    current_intent: leadIntentSchema.nullish(),
    lead_intent: leadIntentSchema.nullish(), // back-compat alias
    status: leadStatusSchema.optional(),
    source: leadSourceSchema.nullish(),
    notes: z.string().trim().max(5000).nullish(),
    city: z.string().trim().max(100).nullish(),
    pincode: z.string().trim().max(20).nullish(),
    pending_action: z.boolean().optional(),
    // Dynamic-field updates — written into lead_data on the row.
    interest: z.string().trim().max(500).nullish(),
    customer_status: z.string().trim().max(50).nullish(),
    wants_to_connect_on_watsapp: z.boolean().nullish(),
    visit_date_time: z.string().datetime({ offset: true }).nullish(),
    // Catalog-driven patches: arbitrary keys defined by the lead-field
    // catalog. These are merged into the existing JSONB so siblings stay
    // intact. Keys are character-constrained to keep payloads sane.
    lead_data_patch: z.record(fieldKeySchema, jsonScalarSchema).optional(),
    custom_data_patch: z
      .record(categoryKeySchema, z.record(fieldKeySchema, jsonScalarSchema))
      .optional(),
  })
  .partial();

export const leadListSchema = z.object({
  org_slug: orgSlugSchema,
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
  q: z.string().trim().max(100).optional(),
  lead_intent: leadIntentSchema.optional(),
  customer_status: z.string().trim().max(50).optional(),
  pending_action: z.boolean().optional(),
  wants_to_connect_on_watsapp: z.boolean().optional(),
  has_phone: z.boolean().optional(),
  source: leadSourceSchema.optional(),
  status: leadStatusSchema.optional(),
});

export type LeadCreateInput = z.infer<typeof leadCreateSchema>;
export type LeadUpdateInput = z.infer<typeof leadUpdateSchema>;
export type LeadListInput = z.infer<typeof leadListSchema>;
