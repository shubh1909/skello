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

export const leadCreateSchema = z.object({
  org_slug: orgSlugSchema,
  name: z.string().trim().min(1).max(200).nullish(),
  interest: z.string().trim().max(500).nullish(),
  summary: z.string().trim().max(5000).nullish(),
  customer_status: z.string().trim().max(50).nullish(),
  lead_intent: leadIntentSchema.nullish(),
  phone: z.string().trim().max(32).nullish(),
  wants_to_connect_on_watsapp: z.boolean().nullish(),
  visit_date_time: z.string().datetime({ offset: true }).nullish(),
  source: leadSourceSchema.nullish(),
  status: leadStatusSchema.optional(),
  notes: z.string().trim().max(5000).nullish(),
  city: z.string().trim().max(100).nullish(),
  pincode: z.string().trim().max(20).nullish(),
  actionable: z.string().trim().max(1000).nullish(),
  recording_url: z.string().trim().url().max(2000).nullish(),
});

export const leadUpdateSchema = leadCreateSchema
  .omit({ org_slug: true })
  .extend({ pending_action: z.boolean().optional() })
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
