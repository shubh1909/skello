import { z } from "zod";

// field_path is constrained on the server side too — see
// lead_field_overrides.field_path check in 20260517000001.
const fieldPath = z.string().trim().min(1).max(200);

export const setLeadFieldOverrideSchema = z.object({
  lead_id: z.string().uuid(),
  field_path: fieldPath,
  value: z.unknown(),
  reason: z.string().trim().max(500).nullish(),
});

export const unlockLeadFieldOverrideSchema = z.object({
  lead_id: z.string().uuid(),
  field_path: fieldPath,
  reason: z.string().trim().max(500).nullish(),
});

export const listLeadFieldOverridesSchema = z.object({
  lead_id: z.string().uuid(),
  limit: z.number().int().min(1).max(500).default(100),
});

export type SetLeadFieldOverrideInput = z.infer<typeof setLeadFieldOverrideSchema>;
export type UnlockLeadFieldOverrideInput = z.infer<typeof unlockLeadFieldOverrideSchema>;
export type ListLeadFieldOverridesInput = z.infer<typeof listLeadFieldOverridesSchema>;
