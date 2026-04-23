-- Fix: the partial unique index on (org_slug, external_id) created in
-- 20260420000004_leads_schema_fixes.sql can't be used as an ON CONFLICT target
-- by PostgREST/supabase-js — it emits a plain `ON CONFLICT (cols)` which
-- Postgres rejects against partial indexes ("42P10: there is no unique or
-- exclusion constraint matching the ON CONFLICT specification").
--
-- Replace with a full (non-partial) unique index. NULL external_id values
-- still won't collide because Postgres treats NULLs as distinct in unique
-- indexes by default, so behaviour is unchanged for non-webhook rows.

drop index if exists public.leads_org_external_idx;

create unique index leads_org_external_idx
  on public.leads (org_slug, external_id);
