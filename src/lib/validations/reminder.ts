import { z } from "zod";

export const reminderIdSchema = z.string().uuid("Invalid reminder id");

export const reminderTypeSchema = z.enum([
  "call",
  "whatsapp",
  "email",
  "visit",
  "other",
]);
export const reminderStatusSchema = z.enum(["pending", "done", "dismissed"]);

export const reminderCreateSchema = z.object({
  organisation_id: z.string().uuid(),
  lead_id: z.string().uuid().nullish(),
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).nullish(),
  remind_at: z.string().datetime({ offset: true }),
  type: reminderTypeSchema.default("other"),
});

export const reminderUpdateSchema = reminderCreateSchema
  .omit({ organisation_id: true })
  .extend({ status: reminderStatusSchema.optional() })
  .partial();

export const reminderListSchema = z.object({
  organisation_id: z.string().uuid(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
  status: reminderStatusSchema.optional(),
  type: reminderTypeSchema.optional(),
  lead_id: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export type ReminderCreateInput = z.infer<typeof reminderCreateSchema>;
export type ReminderUpdateInput = z.infer<typeof reminderUpdateSchema>;
export type ReminderListInput = z.infer<typeof reminderListSchema>;
