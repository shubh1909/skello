-- Leads: add CRM-grade fields (source attribution, pipeline status, notes, locality).
--
-- - `lead_source`  enum: where the lead came from (inbound call, manual, etc.)
-- - `lead_status`  enum: explicit pipeline stage — separate from `lead_intent`
--                  (which is temperature). Both matter: a "hot" lead can be in
--                  any status from "new" to "won" to "lost".
-- - `notes`        free-form operator context.
-- - `city`, `pincode` locality — enables dealer/store routing and regional
--                  analytics.
--
-- `visit_date_time` is already present (added in 20260420000001); not re-added.

-- ---------------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------------

create type if not exists public.lead_source as enum (
  'inbound_call',
  'whatsapp',
  'manual',
  'import',
  'web_form'
);

create type if not exists public.lead_status as enum (
  'new',
  'contacted',
  'qualified',
  'negotiating',
  'won',
  'lost'
);

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.leads
  add column if not exists source  public.lead_source,
  add column if not exists status  public.lead_status not null default 'new',
  add column if not exists notes   text,
  add column if not exists city    text,
  add column if not exists pincode text;

-- ---------------------------------------------------------------------------
-- Backfill: existing rows with an external_id came from the voice agent
-- webhook (inbound); everything else we treat as manual so the historical
-- record stays honest.
-- ---------------------------------------------------------------------------

update public.leads
set source = 'inbound_call'
where source is null and external_id is not null;

update public.leads
set source = 'manual'
where source is null;

-- ---------------------------------------------------------------------------
-- Indexes for the filter patterns we'll add to the leads page.
-- ---------------------------------------------------------------------------

create index if not exists leads_org_status_idx
  on public.leads (org_slug, status);

create index if not exists leads_org_source_idx
  on public.leads (org_slug, source);
