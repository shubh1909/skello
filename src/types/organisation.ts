export interface Organisation {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export type OrganisationInsert = Pick<Organisation, "name" | "slug">;
export type OrganisationUpdate = Partial<Pick<Organisation, "name" | "slug">>;
