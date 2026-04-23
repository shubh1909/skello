import { z } from "zod";

const fromPhone = z
  .string()
  .trim()
  .min(5)
  .max(32)
  .nullish()
  .transform((v) => (v && v.length > 0 ? v : null));

export const bolnaIntegrationUpsertSchema = z.object({
  organisation_id: z.string().uuid(),
  agent_id: z.string().trim().min(1).max(200),
  api_key: z.string().trim().min(1).max(500),
  from_phone_number: fromPhone,
  enabled: z.boolean().default(true),
});

export const bolnaIntegrationUpdateSchema = z.object({
  organisation_id: z.string().uuid(),
  agent_id: z.string().trim().min(1).max(200).optional(),
  api_key: z.string().trim().min(1).max(500).optional(),
  from_phone_number: fromPhone.optional(),
  enabled: z.boolean().optional(),
});

export type BolnaIntegrationUpsertInput = z.infer<
  typeof bolnaIntegrationUpsertSchema
>;
export type BolnaIntegrationUpdateInput = z.infer<
  typeof bolnaIntegrationUpdateSchema
>;
