import { z } from "zod";

const orgRef = z.object({ organisation_id: z.string().uuid() });

export const voiceConfigGetSchema = orgRef;

export const addDialNumberSchema = orgRef.extend({
  phone: z
    .string()
    .trim()
    .min(5)
    .max(32)
    .regex(/^\+?[0-9 ()-]+$/i, "Phone must contain digits, spaces, +, (), or -"),
  label: z.string().trim().max(80).default(""),
});

export const removeDialNumberSchema = orgRef.extend({
  phone: z.string().trim().min(5).max(32),
});

export const renameDialNumberSchema = orgRef.extend({
  phone: z.string().trim().min(5).max(32),
  label: z.string().trim().max(80),
});

export type AddDialNumberInput = z.infer<typeof addDialNumberSchema>;
