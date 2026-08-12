import { z } from "zod";

export const leadIntakeChannelSchema = z.enum([
  "google_ads",
  "whatsapp",
  "portal_99acres",
]);

export const listIntakeSourcesForOrgSchema = z.object({
  organisation_id: z.string().uuid(),
});

export const createIntakeSourceSchema = z.object({
  organisation_id: z.string().uuid(),
  channel: leadIntakeChannelSchema,
  name: z.string().trim().min(1).max(80).nullish(),
});

/**
 * Partial update. Every field optional so the editor can save one control at a
 * time; `undefined` means "leave alone".
 */
export const updateIntakeSourceSchema = z.object({
  organisation_id: z.string().uuid(),
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80).nullish(),
  enabled: z.boolean().optional(),
  /**
   * Credentials to merge in, keyed by name. Which names are accepted depends on
   * the channel and is enforced in the action against an allowlist — a schema
   * can't know the channel, and an unfiltered blob would let any key be written
   * into the credentials jsonb.
   *
   * Values are bounded because they round-trip through someone's clipboard: a
   * token long enough to be truncated by a form field is a token that silently
   * stops matching. Meta's System User tokens are long, hence 500.
   */
  credentials: z
    .record(z.string().min(1).max(40), z.string().trim().min(1).max(500))
    .optional(),
  /** Payload key → target. Provider-authored keys, so bounded but not patterned. */
  field_map: z
    .record(z.string().min(1).max(200), z.string().trim().min(1).max(80))
    .optional(),
});

export const intakeSourceIdSchema = z.object({
  organisation_id: z.string().uuid(),
  id: z.string().uuid(),
});

export const listIntakeEventsSchema = z.object({
  source_id: z.string().uuid().nullish(),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});

export const replayIntakeEventSchema = z.object({
  id: z.string().uuid(),
});

export type CreateIntakeSourceInput = z.infer<typeof createIntakeSourceSchema>;
export type UpdateIntakeSourceInput = z.infer<typeof updateIntakeSourceSchema>;
export type ListIntakeEventsInput = z.infer<typeof listIntakeEventsSchema>;
