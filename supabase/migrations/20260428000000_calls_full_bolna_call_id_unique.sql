-- The calls table originally had a partial unique index on
--   (organisation_id, bolna_call_id) where bolna_call_id is not null
-- which works for direct uniqueness enforcement but breaks PostgREST upsert
-- with ON CONFLICT (organisation_id, bolna_call_id) — PostgreSQL refuses
-- to match a partial index unless the WHERE clause is repeated explicitly,
-- and supabase-js's .upsert() helper doesn't emit that clause. The webhook
-- ingest path needs the upsert to be idempotent on Bolna's call id, so we
-- promote the partial index to a full unique constraint.
--
-- PostgreSQL treats each NULL as distinct in unique constraints, so calls
-- without a bolna_call_id (e.g. rows inserted by initiateCall when the
-- provider request fails before assigning an id) still coexist freely.

drop index if exists public.calls_org_bolna_call_id_key;

alter table public.calls
  drop constraint if exists calls_org_bolna_call_id_key;

alter table public.calls
  add constraint calls_org_bolna_call_id_key
  unique (organisation_id, bolna_call_id);
