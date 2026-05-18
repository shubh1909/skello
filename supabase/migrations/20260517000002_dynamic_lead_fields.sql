-- =============================================================================
-- Phase 3 — Dynamic Lead Fields.
--
-- Two-tier JSONB storage:
--   lead_data    — first-class fields the provider's lead extraction emits
--                  (name, interest, lead_intent, etc.). On `calls` it's an
--                  immutable per-conversation snapshot. On `leads` it's the
--                  rolled-up "current view" (latest non-null wins, gated by
--                  lead_field_overrides).
--   custom_data  — { category: { ...keys } } shape for everything else the
--                  provider sends. Same per-call snapshot vs current-view
--                  split as lead_data.
--
-- A per-org catalog (`lead_field_definitions`) tracks every discovered key so
-- org admins can decide which ones to expose as columns / filters / sort /
-- search on the leads table. The webhook auto-registers new keys on first
-- sight; admins can rename / hide / promote them later.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 1 — JSONB columns on leads and calls.
-- -----------------------------------------------------------------------------

alter table public.leads
  add column if not exists lead_data   jsonb not null default '{}'::jsonb,
  add column if not exists custom_data jsonb not null default '{}'::jsonb;

alter table public.calls
  add column if not exists lead_data   jsonb not null default '{}'::jsonb,
  add column if not exists custom_data jsonb not null default '{}'::jsonb;

-- GIN indexes for @> containment (filters) and key existence checks. Cheap
-- to maintain at this table size; expression indexes for individual hot keys
-- are deferred until any single org crosses ~50k leads.
create index if not exists leads_lead_data_gin    on public.leads using gin (lead_data);
create index if not exists leads_custom_data_gin  on public.leads using gin (custom_data);
create index if not exists calls_lead_data_gin    on public.calls using gin (lead_data);
create index if not exists calls_custom_data_gin  on public.calls using gin (custom_data);

-- -----------------------------------------------------------------------------
-- STEP 2 — lead_field_definitions: per-org catalog of discovered keys.
--   source_column   ∈ {'lead_data','custom_data'} — which jsonb blob this
--                     key lives in.
--   category        — second-level grouping for custom_data ('' for lead_data).
--   key_path        — the leaf key (no nested dots; nested objects become
--                     additional categories).
--   data_type       ∈ {'string','number','boolean','date','enum','unknown'}
--                   — inferred from sample_value on first sight; admin can
--                     override.
--   visible_in_table, filterable, sortable, searchable
--                   — UI exposure flags. All default false so newly discovered
--                     fields don't clutter the leads page until an admin
--                     promotes them.
--   sample_value    — last non-null value seen, for the admin UI preview.
--   last_seen_at    — last webhook that included this key.
--   display_order   — admin-set ordering for the dynamic leads table.
-- -----------------------------------------------------------------------------

-- `CREATE TYPE IF NOT EXISTS` requires Postgres 17; Supabase is on 15/16,
-- so we wrap in DO blocks that swallow the duplicate_object error on replay.
do $$
begin
  create type public.lead_field_source as enum ('lead_data', 'custom_data');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.lead_field_data_type as enum (
    'string', 'number', 'boolean', 'date', 'enum', 'unknown'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.lead_field_definitions (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  source_column     public.lead_field_source not null,
  category          text not null default '' check (char_length(category) <= 100),
  key_path          text not null check (char_length(key_path) between 1 and 200),
  label             text check (label is null or char_length(label) between 1 and 200),
  data_type         public.lead_field_data_type not null default 'unknown',
  visible_in_table  boolean not null default false,
  filterable        boolean not null default false,
  sortable          boolean not null default false,
  searchable        boolean not null default false,
  display_order     integer not null default 1000,
  sample_value      jsonb,
  enum_options      jsonb,
  last_seen_at      timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organisation_id, source_column, category, key_path)
);

create index if not exists lead_field_definitions_org_visible_idx
  on public.lead_field_definitions (organisation_id, visible_in_table, display_order)
  where visible_in_table = true;
create index if not exists lead_field_definitions_org_idx
  on public.lead_field_definitions (organisation_id);

drop trigger if exists lead_field_definitions_set_updated_at on public.lead_field_definitions;
create trigger lead_field_definitions_set_updated_at
  before update on public.lead_field_definitions
  for each row execute function public.set_updated_at();

alter table public.lead_field_definitions enable row level security;

drop policy if exists "lead_field_definitions_select_own_org" on public.lead_field_definitions;
create policy "lead_field_definitions_select_own_org"
  on public.lead_field_definitions for select
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );
-- Writes go via service-role (auto-discovery from webhook) or admin Server
-- Actions (catalog editing) — no authenticated write policy needed.

-- -----------------------------------------------------------------------------
-- STEP 3 — register_lead_field RPC.
--   Idempotent upsert. On first sight: insert with inferred data_type and
--   sample_value. On replay: bump last_seen_at + refresh sample_value, but
--   NEVER overwrite admin-curated label / data_type / visibility flags.
-- -----------------------------------------------------------------------------

create or replace function public.register_lead_field(
  p_org_id        uuid,
  p_source        public.lead_field_source,
  p_category      text,
  p_key_path      text,
  p_sample_value  jsonb,
  p_data_type     public.lead_field_data_type default 'unknown'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.lead_field_definitions (
    organisation_id, source_column, category, key_path,
    data_type, sample_value, last_seen_at
  )
  values (
    p_org_id, p_source, coalesce(p_category, ''), p_key_path,
    p_data_type, p_sample_value, now()
  )
  on conflict (organisation_id, source_column, category, key_path) do update
  set
    sample_value  = coalesce(excluded.sample_value, lead_field_definitions.sample_value),
    last_seen_at  = now(),
    -- Promote data_type if we previously had 'unknown' and now we know.
    data_type     = case
                      when lead_field_definitions.data_type = 'unknown'
                       and excluded.data_type <> 'unknown'
                      then excluded.data_type
                      else lead_field_definitions.data_type
                    end;
end;
$$;

grant execute on function public.register_lead_field(
  uuid, public.lead_field_source, text, text, jsonb, public.lead_field_data_type
) to service_role;

-- -----------------------------------------------------------------------------
-- STEP 4 — Generated tsvector column on leads for the search box.
--   Concatenates name + interest + summary + notes + a flattened text dump
--   of lead_data values. Indexed with GIN for fast full-text query.
--   We use a small immutable helper to flatten jsonb values to a single
--   space-separated string so the generated column can reference it.
-- -----------------------------------------------------------------------------

create or replace function public.jsonb_values_text(p jsonb)
returns text
language sql
immutable
parallel safe
as $$
  select coalesce(string_agg(value, ' '), '')
  from jsonb_each_text(coalesce(p, '{}'::jsonb))
$$;

alter table public.leads
  add column if not exists search_tsv tsvector generated always as (
    to_tsvector('simple',
      coalesce(name, '') || ' ' ||
      coalesce(interest, '') || ' ' ||
      coalesce(summary, '') || ' ' ||
      coalesce(notes, '') || ' ' ||
      coalesce(public.jsonb_values_text(lead_data), '')
    )
  ) stored;

create index if not exists leads_search_tsv_gin
  on public.leads using gin (search_tsv);

-- -----------------------------------------------------------------------------
-- STEP 5 — apply_lead_field_jsonb RPC.
--   Sets a nested key inside lead_data / custom_data without clobbering
--   siblings. Called by setLeadFieldOverride() when the admin edits a
--   dynamic field. The p_path argument is the array of nested keys AFTER
--   the column root (e.g. ['city'] for lead_data.city, or
--   ['preferences','budget'] for custom_data.preferences.budget).
-- -----------------------------------------------------------------------------

create or replace function public.apply_lead_field_jsonb(
  p_lead_id uuid,
  p_org_id  uuid,
  p_column  text,
  p_path    text[],
  p_value   jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_column not in ('lead_data', 'custom_data') then
    raise exception 'Unsupported column: %', p_column;
  end if;
  if array_length(p_path, 1) is null or array_length(p_path, 1) < 1 then
    raise exception 'p_path must contain at least one segment';
  end if;

  if p_column = 'lead_data' then
    update public.leads
       set lead_data = jsonb_set(coalesce(lead_data, '{}'::jsonb), p_path, coalesce(p_value, 'null'::jsonb), true)
     where id = p_lead_id and organisation_id = p_org_id;
  else
    update public.leads
       set custom_data = jsonb_set(coalesce(custom_data, '{}'::jsonb), p_path, coalesce(p_value, 'null'::jsonb), true)
     where id = p_lead_id and organisation_id = p_org_id;
  end if;
end;
$$;

grant execute on function public.apply_lead_field_jsonb(uuid, uuid, text, text[], jsonb)
  to service_role;
