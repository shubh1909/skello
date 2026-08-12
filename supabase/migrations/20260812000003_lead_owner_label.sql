-- =============================================================================
-- leads.owner_label — who on the floor owns this lead.
--
-- A LABEL, NOT A USER REFERENCE. This codebase has no membership model:
-- tenancy is single-owner via organisations.owner_id, and there is no members
-- table, no invites and no org-scoped roles. A real assignment feature needs
-- all three. What the sheet needs today is "which of our people is on this" —
-- so this is a text label whose permitted values are admin-curated.
--
-- The option list reuses lead_field_definitions.enum_options rather than
-- inventing a second config table. That column already exists, the admin
-- catalog UI already edits it, and owner_label is registered below as a
-- first-class `column` field so it appears there alongside everything else.
--
-- When a membership model does arrive, this becomes the migration path rather
-- than the obstacle: the labels map onto real users, and the column can be
-- backfilled to a FK without the UI changing shape.
-- =============================================================================

alter table public.leads
  add column if not exists owner_label text;

do $$
begin
  alter table public.leads
    add constraint leads_owner_label_length
    check (owner_label is null or char_length(owner_label) between 1 and 80);
exception
  when duplicate_object then null;
end $$;

-- Filtering "my leads" is the point of the field, so index it — partial,
-- because most rows are unassigned and those are never the query.
create index if not exists leads_org_owner_label_idx
  on public.leads (organisation_id, owner_label)
  where owner_label is not null;

comment on column public.leads.owner_label is
  'Admin-curated label naming the person who owns this lead. Deliberately not '
  'a user FK — this codebase has no membership model. Permitted values live in '
  'lead_field_definitions.enum_options for the owner_label column.';

-- -----------------------------------------------------------------------------
-- Register the two new first-class columns in the per-org catalog.
--
-- Without this they are invisible to both the leads-table column manager AND
-- the lead-sheet binding picker, which builds its field list from this same
-- catalog — an admin could not put the intent score on a card even though the
-- column exists.
--
-- Both default to visible_in_table = false: the leads table is already wide,
-- and a column nobody asked for appearing in everyone's grid overnight is a
-- worse first impression than one they have to switch on.
-- -----------------------------------------------------------------------------

insert into public.lead_field_definitions (
  organisation_id, source_column, category, key_path, label,
  data_type, visible_in_table, filterable, sortable, searchable,
  display_order, enum_options
)
select
  o.id,
  'column'::public.lead_field_source,
  '',
  col.key_path,
  col.label,
  col.data_type::public.lead_field_data_type,
  false,
  col.filterable,
  col.sortable,
  false,
  col.display_order,
  col.enum_options::jsonb
from public.organisations o
cross join (values
  ('current_intent_score', 'Intent score', 'number', false, true,  145, null),
  ('owner_label',          'Owner',        'enum',   true,  true,  160, '[]')
) as col(key_path, label, data_type, filterable, sortable, display_order, enum_options)
on conflict (organisation_id, source_column, category, key_path) do nothing;

-- Replace the new-org seed so fresh orgs get the same catalog. The existing six
-- rows are repeated verbatim — CREATE OR REPLACE takes a whole body, so there
-- is no way to append to it, and leaving them out would silently un-seed every
-- org created after this migration.
create or replace function public.seed_org_first_class_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.lead_field_definitions (
    organisation_id, source_column, category, key_path, label,
    data_type, visible_in_table, filterable, sortable, searchable,
    display_order, enum_options
  )
  values
    (new.id, 'column', '', 'inbound_calls',        'In',            'number',  true,  false, true,  false, 100, null),
    (new.id, 'column', '', 'outbound_calls',       'Out',           'number',  true,  false, true,  false, 110, null),
    (new.id, 'column', '', 'last_call_at',         'Last contact',  'date',    true,  false, true,  false, 120, null),
    (new.id, 'column', '', 'first_call_at',        'First contact', 'date',    true,  false, true,  false, 130, null),
    (new.id, 'column', '', 'current_intent',       'Intent',        'enum',    true,  true,  true,  false, 140, null),
    (new.id, 'column', '', 'current_intent_score', 'Intent score',  'number',  false, false, true,  false, 145, null),
    (new.id, 'column', '', 'pending_action',       'Pending',       'boolean', true,  true,  false, false, 150, null),
    (new.id, 'column', '', 'owner_label',          'Owner',         'enum',    false, true,  true,  false, 160, '[]'::jsonb)
  on conflict (organisation_id, source_column, category, key_path) do nothing;
  return new;
end;
$$;
