import { z } from "zod";

import { leadFieldSourceSchema } from "./lead-field-definition";

export const leadSheetSlotSchema = z.enum([
  "stat_card",
  "wants",
  "header_meta",
]);

export const leadSheetFormatSchema = z.enum([
  "text",
  "number",
  "currency_inr",
  "date",
  "datetime",
  "boolean",
  "enum_badge",
]);

const keyPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9_\-.]+$/, "Invalid field key");

const categorySchema = z
  .string()
  .trim()
  .max(100)
  .regex(/^[a-zA-Z0-9_\-. ]*$/, "Invalid category");

export const listLeadSheetBindingsSchema = z.object({
  organisation_id: z.string().uuid(),
});

/**
 * Upsert one binding into a (slot, slot_position) cell.
 *
 * Position is bounded here as well as in the DB. `stat_card` is capped at 3
 * because the card row's layout depends on it; the other slots are capped at a
 * number that stops a runaway loop, not at a design constraint.
 */
export const upsertLeadSheetBindingSchema = z
  .object({
    organisation_id: z.string().uuid(),
    slot: leadSheetSlotSchema,
    slot_position: z.number().int().min(0).max(11),
    label: z.string().trim().min(1).max(60),
    source_column: leadFieldSourceSchema,
    category: categorySchema.default(""),
    key_path: keyPathSchema,
    caption_source_column: leadFieldSourceSchema.nullish(),
    caption_category: categorySchema.default(""),
    caption_key_path: keyPathSchema.nullish(),
    caption_static: z.string().trim().max(120).nullish(),
    format: leadSheetFormatSchema.default("text"),
  })
  .superRefine((v, ctx) => {
    if (v.slot === "stat_card" && v.slot_position > 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slot_position"],
        message: "The sheet shows three stat cards",
      });
    }
    // Mirrors the DB's two caption CHECKs. Caught here so the admin gets a
    // field-level message instead of a raw constraint-violation string.
    const hasCaptionSource = Boolean(v.caption_source_column);
    const hasCaptionKey = Boolean(v.caption_key_path);
    if (hasCaptionSource !== hasCaptionKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["caption_key_path"],
        message: "A field caption needs both a source and a key",
      });
    }
    if (v.caption_static && hasCaptionSource) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["caption_static"],
        message: "Use either a caption field or fixed text, not both",
      });
    }
  });

export const deleteLeadSheetBindingSchema = z.object({
  organisation_id: z.string().uuid(),
  id: z.string().uuid(),
});

export type ListLeadSheetBindingsInput = z.infer<
  typeof listLeadSheetBindingsSchema
>;
export type UpsertLeadSheetBindingInput = z.infer<
  typeof upsertLeadSheetBindingSchema
>;
export type DeleteLeadSheetBindingInput = z.infer<
  typeof deleteLeadSheetBindingSchema
>;
