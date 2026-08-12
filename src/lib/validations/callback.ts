import { z } from "zod";

export const listLeadCallbacksSchema = z.object({
  lead_id: z.string().uuid("Invalid lead id"),
  limit: z.number().int().min(1).max(50).default(10),
});

export const assignCallbackSchema = z.object({
  lead_id: z.string().uuid("Invalid lead id"),
  // ISO-8601 with offset. The sheet sends an absolute instant rather than a
  // wall-clock string: the drainer compares against now() in UTC, and a naive
  // local time would land the callback hours out for anyone not on the
  // server's timezone.
  scheduled_at: z.string().datetime({ offset: true }),
});

export const cancelCallbackSchema = z.object({
  id: z.string().uuid("Invalid callback id"),
});

export type ListLeadCallbacksInput = z.infer<typeof listLeadCallbacksSchema>;
export type AssignCallbackInput = z.infer<typeof assignCallbackSchema>;
export type CancelCallbackInput = z.infer<typeof cancelCallbackSchema>;
