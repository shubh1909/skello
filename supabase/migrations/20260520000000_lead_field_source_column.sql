-- Extend the `lead_field_source` enum so first-class table columns
-- (In, Out, Last contact, First contact, Intent, Pending) can be
-- toggled from the same admin catalog UI that already handles dynamic
-- JSONB fields.
--
-- `ALTER TYPE ... ADD VALUE` cannot use the new value in the same
-- transaction it's added in. The seed of the new rows therefore lives
-- in `20260520000001_lead_catalog_columns_and_search.sql`.

alter type public.lead_field_source add value if not exists 'column';
