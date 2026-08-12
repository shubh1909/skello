-- =============================================================================
-- Lead detail sheet — admin-configurable field bindings.
--
-- WHY THIS EXISTS
--
-- The lead sheet used to hardcode which extracted fields it showed. That works
-- for exactly one vertical. A real-estate org wants "Location preference" and
-- "Budget fit" on the sheet; a lending org wants "Loan amount" and "Salary
-- band"; the voice agent emits whatever each org's extraction prompt asks for.
-- Hardcoding meant every new vertical was a code change, and every org that
-- didn't match the hardcoded keys saw blank panels with no way to fix it.
--
-- ONE MECHANISM, THREE SLOTS. The stat-card row, the "what they want" panel and
-- the header meta line are all the same problem — "show this field, with this
-- label, in this position" — so they share one table and one resolver rather
-- than three near-identical ones that drift apart.
--
--   stat_card    the three cards under the tab bar (capped at 3, see the CHECK)
--   wants        the "what they want" definition list
--   header_meta  the muted line under the lead's name
--
-- A binding points at the SAME address space as lead_field_definitions:
-- (source_column, category, key_path). That is deliberate — the admin UI lists
-- bindable fields straight from that catalog, which the webhook already
-- auto-populates on first sight of a new extraction key. No second registry to
-- keep in step.
--
-- `column` bindings resolve against an allowlist in TypeScript
-- (src/lib/leads/sheet-bindings.ts), NOT against arbitrary SQL. A binding is
-- admin-authored config, so an unrecognised key_path renders nothing rather
-- than reaching the database.
-- =============================================================================

create table if not exists public.lead_sheet_bindings (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,

  slot              text not null check (slot in ('stat_card', 'wants', 'header_meta')),
  -- Named `slot_position`, not `position`: POSITION is a col_name_keyword in
  -- Postgres, and a bare `position` in a CHECK sits one parser rule away from
  -- the POSITION(x IN y) function form. Not worth the ambiguity.
  slot_position     integer not null check (slot_position >= 0),

  label             text not null check (char_length(label) between 1 and 60),

  -- Where the value comes from. Same address space as lead_field_definitions.
  source_column     public.lead_field_source not null,
  category          text not null default '' check (char_length(category) <= 100),
  key_path          text not null check (char_length(key_path) between 1 and 200),

  -- The small muted line under a stat card's value. Either a second field or a
  -- fixed string — never both (see the CHECK below).
  caption_source_column public.lead_field_source,
  caption_category      text not null default '' check (char_length(caption_category) <= 100),
  caption_key_path      text check (caption_key_path is null or char_length(caption_key_path) between 1 and 200),
  caption_static        text check (caption_static is null or char_length(caption_static) <= 120),

  format            text not null default 'text' check (
    format in ('text', 'number', 'currency_inr', 'date', 'datetime', 'boolean', 'enum_badge')
  ),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (organisation_id, slot, slot_position),

  -- The mockup's card row is three wide and the layout depends on it. Enforced
  -- here rather than in the UI so a stray fourth card can't be written by an
  -- action that forgot to check.
  constraint lead_sheet_bindings_stat_card_max
    check (slot <> 'stat_card' or slot_position between 0 and 2),

  -- A field caption needs a key to read; a static caption needs no field. Both
  -- at once is ambiguous about which wins, so it is rejected outright.
  constraint lead_sheet_bindings_caption_shape check (
    (caption_source_column is null and caption_key_path is null)
    or (caption_source_column is not null and caption_key_path is not null)
  ),
  constraint lead_sheet_bindings_caption_exclusive check (
    caption_static is null or caption_source_column is null
  )
);

create index if not exists lead_sheet_bindings_org_slot_idx
  on public.lead_sheet_bindings (organisation_id, slot, slot_position);

drop trigger if exists lead_sheet_bindings_set_updated_at on public.lead_sheet_bindings;
create trigger lead_sheet_bindings_set_updated_at
  before update on public.lead_sheet_bindings
  for each row execute function public.set_updated_at();

alter table public.lead_sheet_bindings enable row level security;

-- Read: any authenticated user, for orgs they own. The sheet renders for
-- ordinary users, so unlike lead_field_definitions' admin-only editing surface
-- this one is genuinely read on the hot path.
--
-- Tenancy here is single-owner (organisations.owner_id) — there is no
-- membership table in this codebase. `(select auth.uid())` is wrapped for
-- planner caching, matching every other policy in the repo.
drop policy if exists "lead_sheet_bindings_select_own_org" on public.lead_sheet_bindings;
create policy "lead_sheet_bindings_select_own_org"
  on public.lead_sheet_bindings for select
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );
-- Writes go through admin Server Actions on the service-role client, which
-- check platform-admin or org-owner themselves. No authenticated write policy.

-- -----------------------------------------------------------------------------
-- Defaults.
--
-- Seeded rather than left empty, because an unconfigured org would otherwise
-- meet a lead sheet with three blank cards and an empty panel — which reads as
-- broken software, not as "needs configuring". Every default below binds to
-- something EVERY org has: first-class lead columns and the two extraction keys
-- the provider has emitted since the remodel.
--
-- Rows whose value resolves to null are hidden by the renderer, so an org whose
-- agent never emits `interest` sees a shorter panel, not an empty labelled row.
-- -----------------------------------------------------------------------------

create or replace function public.seed_org_lead_sheet_bindings(p_org_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.lead_sheet_bindings (
    organisation_id, slot, slot_position, label,
    source_column, category, key_path,
    caption_source_column, caption_category, caption_key_path, caption_static,
    format
  )
  select
    p_org_id, d.slot, d.slot_position, d.label,
    d.source_column::public.lead_field_source, d.category, d.key_path,
    null, '', null, d.caption_static,
    d.format
  from (values
    ('stat_card',   0, 'Intent',       'column',    '', 'current_intent', 'Lead temperature',  'enum_badge'),
    ('stat_card',   1, 'Calls placed', 'column',    '', 'outbound_calls', 'Outbound attempts', 'number'),
    ('stat_card',   2, 'Last contact', 'column',    '', 'last_call_at',   null,                'date'),
    ('wants',       0, 'Interest',     'lead_data', '', 'interest',       null,                'text'),
    ('wants',       1, 'Next step',    'lead_data', '', 'actionable',     null,                'text'),
    ('header_meta', 0, 'Phone',        'column',    '', 'phone',          null,                'text'),
    ('header_meta', 1, 'City',         'column',    '', 'city',           null,                'text'),
    ('header_meta', 2, 'Source',       'column',    '', 'source',         null,                'text')
  ) as d(slot, slot_position, label, source_column, category, key_path, caption_static, format)
  on conflict (organisation_id, slot, slot_position) do nothing;
$$;

-- Existing orgs.
select public.seed_org_lead_sheet_bindings(o.id) from public.organisations o;

-- New orgs. Separate trigger from tr_seed_first_class_columns rather than
-- editing it: that one seeds the leads TABLE catalog, this one seeds the lead
-- SHEET layout, and folding them together would mean a change to either has to
-- reason about both.
create or replace function public.tg_seed_org_lead_sheet_bindings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_org_lead_sheet_bindings(new.id);
  return new;
end;
$$;

drop trigger if exists tr_seed_lead_sheet_bindings on public.organisations;
create trigger tr_seed_lead_sheet_bindings
  after insert on public.organisations
  for each row execute function public.tg_seed_org_lead_sheet_bindings();

comment on table public.lead_sheet_bindings is
  'Per-org configuration of which extracted or first-class lead fields appear '
  'in the lead detail sheet, in which slot and position, under which label. '
  'Addresses fields the same way lead_field_definitions does.';
