import { z } from "zod";

export const registerVoiceAgentSchema = z.object({
  organisation_id: z.string().uuid(),
  agent_id: z.string().trim().min(1).max(200),
  label: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export const updateVoiceAgentSchema = z.object({
  organisation_id: z.string().uuid(),
  agent_id: z.string().trim().min(1).max(200),
  label: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null))
    .optional(),
  enabled: z.boolean().optional(),
});

export const removeVoiceAgentSchema = z.object({
  organisation_id: z.string().uuid(),
  agent_id: z.string().trim().min(1).max(200),
});

export type RegisterVoiceAgentInput = z.infer<typeof registerVoiceAgentSchema>;
export type UpdateVoiceAgentInput = z.infer<typeof updateVoiceAgentSchema>;
export type RemoveVoiceAgentInput = z.infer<typeof removeVoiceAgentSchema>;
