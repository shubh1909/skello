import { z } from "zod";

export const campaignRetryTriggerSchema = z.enum([
  "no_answer",
  "busy",
  "failed",
  "canceled",
]);

export const campaignStatusSchema = z.enum([
  "draft",
  "scheduled",
  "in_progress",
  "paused",
  "stopped",
  "completed",
  "failed",
]);

export const campaignContactInputSchema = z.object({
  raw_phone: z.string().min(1).max(64),
  phone: z
    .string()
    .min(5)
    .max(32)
    .regex(/^\d+$/, "Phone must be digits only after normalization"),
  name: z.string().max(200).nullish(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const createCampaignSchema = z.object({
  organisation_id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  file_name: z.string().max(300).nullish(),
  schedule_mode: z.enum(["now", "later"]),
  // ISO datetime, required when schedule_mode === "later"
  scheduled_at: z.string().datetime().nullish(),
  // Either of these can be left null/empty to inherit the org default from
  // bolna_integrations. If supplied, the action verifies the value is one of
  // the saved options (or the default itself).
  agent_id: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null)),
  from_phone_number: z
    .string()
    .trim()
    .min(5)
    .max(32)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null)),
  // The caller-ID pool to rotate across. When 2+ numbers are chosen the
  // dispatcher round-robins under a per-number daily cap. Empty falls back to
  // from_phone_number, then the org default. Capped at 50 to bound the array.
  from_phone_numbers: z
    .array(z.string().trim().min(5).max(32))
    .max(50)
    .default([]),
  max_attempts: z.number().int().min(1).max(6),
  retry_interval_seconds: z.number().int().min(60).max(86400),
  retry_on: z.array(campaignRetryTriggerSchema).max(4),
  contacts: z.array(campaignContactInputSchema).min(1).max(10000),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const campaignIdSchema = z.object({ id: z.string().uuid() });

export const listCampaignsSchema = z.object({
  organisation_id: z.string().uuid(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  status: campaignStatusSchema.optional(),
});

export type ListCampaignsInput = z.infer<typeof listCampaignsSchema>;
