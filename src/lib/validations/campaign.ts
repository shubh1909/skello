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

// IANA timezone names supported by the runtime. Guards against a client sending
// an arbitrary string that would later make every window check throw.
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Calling window: hours-of-day + weekday guard for dialing. Sent as a nested
// object (or null = no window) so the three columns stay all-or-nothing.
export const callingWindowSchema = z
  .object({
    // Minutes since local midnight. start in [0,1439], end in [1,1440].
    start_minute: z.number().int().min(0).max(1439),
    end_minute: z.number().int().min(1).max(1440),
    // Allowed weekdays 0=Sun..6=Sat. Empty = every day. De-duped on the client;
    // capped at 7 to bound the array.
    days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine(isValidTimeZone, "Unknown timezone"),
  })
  .refine((w) => w.end_minute > w.start_minute, {
    message: "Calling window end must be after the start",
    path: ["end_minute"],
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
  max_attempts: z.number().int().min(1).max(10),
  retry_interval_seconds: z.number().int().min(60).max(86400),
  retry_on: z.array(campaignRetryTriggerSchema).max(4),
  // Caller-ID switching (connect-rate based). Defaults match the DB so older
  // callers that omit them keep working.
  switch_connect_rate_floor: z.number().int().min(0).max(100).default(30),
  switch_window_minutes: z.number().int().min(5).max(1440).default(60),
  switch_min_samples: z.number().int().min(1).max(1000).default(20),
  // Null (or omitted) = dial any time. When set, the dispatcher only dials
  // inside the window and defers due contacts to the next open instant.
  calling_window: callingWindowSchema.nullish().default(null),
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
