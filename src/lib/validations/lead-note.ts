import { z } from "zod";

export const listLeadNotesSchema = z.object({
  lead_id: z.string().uuid("Invalid lead id"),
  limit: z.number().int().min(1).max(200).default(100),
});

export const createLeadNoteSchema = z.object({
  lead_id: z.string().uuid("Invalid lead id"),
  // Matches the DB CHECK. Trimmed first, so a note of only whitespace is
  // rejected as empty rather than stored as a blank line.
  body: z.string().trim().min(1, "Write something first").max(5000),
});

export const deleteLeadNoteSchema = z.object({
  id: z.string().uuid("Invalid note id"),
});

export type ListLeadNotesInput = z.infer<typeof listLeadNotesSchema>;
export type CreateLeadNoteInput = z.infer<typeof createLeadNoteSchema>;
export type DeleteLeadNoteInput = z.infer<typeof deleteLeadNoteSchema>;
