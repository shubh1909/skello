import { z } from "zod";

// Wire format for one row of a Bolna CSV import. The browser parses the raw
// CSV, reconstructs the nested `lead_data` shape from the flat
// `extracted_data_lead_data_*` columns, and ships rows in chunks to the
// server action. The server re-validates with this schema — defence in depth
// against a malicious or buggy client payload.

const REASONING_MAX = 5_000;

const leadFieldSchema = z.object({
  objective: z
    .union([z.string(), z.number(), z.boolean(), z.null()])
    .optional(),
  subjective: z
    .union([z.string(), z.number(), z.boolean(), z.null()])
    .optional(),
  confidence: z.union([z.number(), z.null()]).optional(),
  confidence_label: z.string().max(200).nullish(),
  validation: z.unknown().optional(),
  reasoning_objective: z.string().max(REASONING_MAX).nullish(),
  reasoning_subjective: z.string().max(REASONING_MAX).nullish(),
});

export const bolnaCsvRowSchema = z.object({
  id: z.string().trim().min(1).max(200),
  agent_id: z.string().trim().min(1).max(200),
  user_number: z.string().trim().nullable().default(null),
  agent_number: z.string().trim().nullable().default(null),
  status: z.string().trim().nullable().default(null),
  duration: z.number().finite().nullable().default(null),
  recording_url: z.string().trim().nullable().default(null),
  // Transcripts can be large blobs; cap at 200k chars to bound payload size.
  transcript: z.string().max(200_000).nullable().default(null),
  created_at: z.string().trim().nullable().default(null),
  scheduled_at: z.string().trim().nullable().default(null),
  total_cost: z.number().finite().nullable().default(null),
  hangup_by: z.string().trim().nullable().default(null),
  hangup_reason: z.string().trim().nullable().default(null),
  // Reconstructed nested map: { lead_score: { objective: 1, ... }, ... }.
  // Empty object means the CSV row had no extracted_data — we still bootstrap
  // the call row in that branch.
  lead_data: z.record(z.string(), leadFieldSchema),
});

// 50 rows per chunk is a safe middle ground: small enough to keep individual
// server-action requests well under platform body-size limits even with full
// transcripts, large enough that a 5k upload finishes in 100 sequential
// requests rather than 5,000.
export const IMPORT_CHUNK_SIZE = 50;

export const importChunkInputSchema = z.object({
  rows: z.array(bolnaCsvRowSchema).min(1).max(IMPORT_CHUNK_SIZE),
});

export type BolnaCsvRow = z.infer<typeof bolnaCsvRowSchema>;
export type ImportChunkInput = z.infer<typeof importChunkInputSchema>;
