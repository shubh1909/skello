import { z } from "zod";

export const leadIdSchema = z.string().uuid("Invalid lead id");

export const leadIntentSchema = z.enum(["hot", "warm", "cold"]);

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
  product: z.string().trim().max(500).nullish(),
  customer_status: z.string().trim().max(50).nullish(),
  lead_intent: leadIntentSchema.nullish(),
  phone: z.string().trim().max(32).nullish(),
  wants_to_connect_on_watsapp: z.boolean().nullish(),
  visit_date_time: z.string().datetime({ offset: true }).nullish(),
});

export const leadUpdateSchema = leadCreateSchema
  .omit({ org_slug: true })
  .extend({ contacted_on_watsapp: z.boolean().optional() })
  .partial();

export const leadListSchema = z.object({
  org_slug: orgSlugSchema,
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
  q: z.string().trim().max(100).optional(),
  lead_intent: leadIntentSchema.optional(),
  customer_status: z.string().trim().max(50).optional(),
  contacted_on_watsapp: z.boolean().optional(),
  wants_to_connect_on_watsapp: z.boolean().optional(),
  has_phone: z.boolean().optional(),
});

export type LeadCreateInput = z.infer<typeof leadCreateSchema>;
export type LeadUpdateInput = z.infer<typeof leadUpdateSchema>;
export type LeadListInput = z.infer<typeof leadListSchema>;
