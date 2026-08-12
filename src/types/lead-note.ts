/**
 * A dated, authored observation on a lead — the Notes tab.
 *
 * Distinct from `leads.notes`, which is the lead's standing description and is
 * edited in place. These are append-only.
 *
 * `author_email` is denormalised at write time: `author_id` goes null if the
 * account is removed, and "who said this" is the half worth keeping.
 */
export interface LeadNote {
  id: string;
  organisation_id: string;
  lead_id: string;
  author_id: string | null;
  author_email: string | null;
  body: string;
  created_at: string;
}
