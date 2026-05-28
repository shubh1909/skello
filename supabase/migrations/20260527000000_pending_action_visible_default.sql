-- Force the Pending action column visible across every org. The seed in
-- 20260520000001_lead_catalog_columns_and_search.sql already defaults
-- visible_in_table = true, but admins can toggle visibility off via the
-- catalog manager UI. Operators rely on this column to triage follow-ups
-- so the default is now hard-set across all existing orgs; new orgs
-- continue to inherit visible = true from the seed trigger.

update public.lead_field_definitions
   set visible_in_table = true,
       updated_at = now()
 where source_column = 'column'
   and key_path = 'pending_action'
   and visible_in_table is distinct from true;
