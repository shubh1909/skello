import { z } from "zod";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const organisationCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(63)
    .regex(slugRegex, "Slug must be lowercase, numbers and hyphens only"),
});

export const organisationUpdateSchema = organisationCreateSchema.partial();

export const organisationIdSchema = z.string().uuid("Invalid organisation id");

export type OrganisationCreateInput = z.infer<typeof organisationCreateSchema>;
export type OrganisationUpdateInput = z.infer<typeof organisationUpdateSchema>;
