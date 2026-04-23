import { z } from "zod";

export const callStatusSchema = z.enum([
  "initiated",
  "ringing",
  "in_progress",
  "completed",
  "failed",
  "no_answer",
  "busy",
  "canceled",
]);

export const callInitiateSchema = z.object({
  lead_id: z.string().uuid(),
});

export const callListSchema = z.object({
  organisation_id: z.string().uuid(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
  lead_id: z.string().uuid().optional(),
  status: callStatusSchema.optional(),
});

export type CallInitiateInput = z.infer<typeof callInitiateSchema>;
export type CallListInput = z.infer<typeof callListSchema>;
