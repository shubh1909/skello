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

export const callDirectionSchema = z.enum(["inbound", "outbound"]);

export const callInitiateSchema = z.object({
  lead_id: z.string().uuid(),
});

export const callSortFieldSchema = z.enum([
  "started_at",
  "duration_seconds",
  "agent_id",
  "status",
  "direction",
]);

export const callSortDirSchema = z.enum(["asc", "desc"]);

export const callListSchema = z.object({
  organisation_id: z.string().uuid(),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).default(0),
  lead_id: z.string().uuid().optional(),
  // When set, restrict to calls placed for this campaign's contacts. The
  // action resolves it to the campaign's contact-id set before querying.
  campaign_id: z.string().uuid().optional(),
  status: callStatusSchema.optional(),
  direction: callDirectionSchema.optional(),
  // Semantic disposition key (per-org configurable — see org_outcome_policies),
  // so it's an open string rather than an enum.
  call_outcome: z.string().trim().min(1).max(100).optional(),
  agent_id: z.string().min(1).max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  q: z.string().max(200).optional(),
  sort: callSortFieldSchema.default("started_at"),
  dir: callSortDirSchema.default("desc"),
});

export type CallInitiateInput = z.infer<typeof callInitiateSchema>;
export type CallListInput = z.infer<typeof callListSchema>;
