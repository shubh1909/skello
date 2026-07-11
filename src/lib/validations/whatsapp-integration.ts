import { z } from "zod";

// Optional text that normalises "" → null so blank fields don't persist empties.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null));

// Meta language code: lowercase language, optional _REGION (e.g. en, en_US,
// pt_BR). Must match how the template was approved or the BSP 400s.
const languageCode = z
  .string()
  .trim()
  .regex(
    /^[a-zA-Z]{2,3}([_-][a-zA-Z]{2,4})?$/,
    "Enter a valid language code like en or en_US",
  );

// Blank / missing language → "en" (the historical default) rather than a
// validation error, so an operator who leaves it empty keeps working.
const languageWithDefault = z.preprocess(
  (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : "en"),
  languageCode,
);

export const whatsappIntegrationUpsertSchema = z.object({
  organisation_id: z.string().uuid(),
  provider: z.string().trim().min(1).max(40).default("kwikengage"),
  api_token: z.string().trim().min(1).max(500),
  base_url: optionalText(300),
  sender_id: optionalText(64),
  template_name: optionalText(200),
  template_language: languageWithDefault,
  enabled: z.boolean().default(true),
});

export const whatsappIntegrationUpdateSchema = z.object({
  organisation_id: z.string().uuid(),
  provider: z.string().trim().min(1).max(40).optional(),
  // On update, a blank token means "keep the existing one" — the action drops
  // undefined fields, so omit rather than null it.
  api_token: z.string().trim().min(1).max(500).optional(),
  base_url: optionalText(300).optional(),
  sender_id: optionalText(64).optional(),
  template_name: optionalText(200).optional(),
  template_language: languageCode.optional(),
  enabled: z.boolean().optional(),
});

export type WhatsAppIntegrationUpsertInput = z.infer<
  typeof whatsappIntegrationUpsertSchema
>;
export type WhatsAppIntegrationUpdateInput = z.infer<
  typeof whatsappIntegrationUpdateSchema
>;
