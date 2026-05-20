import { z } from "zod";

const sourceColumn = z.enum(["lead_data", "custom_data", "column"]);
const dataType = z.enum([
  "string",
  "number",
  "boolean",
  "date",
  "enum",
  "unknown",
]);

export const listLeadFieldDefinitionsSchema = z.object({
  organisation_id: z.string().uuid(),
  visible_only: z.boolean().default(false),
});

export const updateLeadFieldDefinitionSchema = z.object({
  id: z.string().uuid(),
  organisation_id: z.string().uuid(),
  label: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null))
    .optional(),
  data_type: dataType.optional(),
  visible_in_table: z.boolean().optional(),
  filterable: z.boolean().optional(),
  sortable: z.boolean().optional(),
  searchable: z.boolean().optional(),
  display_order: z.number().int().min(0).max(10_000).optional(),
  enum_options: z.array(z.string().min(1).max(100)).max(100).nullish(),
});

export type ListLeadFieldDefinitionsInput = z.infer<
  typeof listLeadFieldDefinitionsSchema
>;
export type UpdateLeadFieldDefinitionInput = z.infer<
  typeof updateLeadFieldDefinitionSchema
>;
export { sourceColumn as leadFieldSourceSchema, dataType as leadFieldDataTypeSchema };
