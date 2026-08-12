-- =============================================================================
-- Lead notes — the Notes tab on the lead detail sheet.
--
-- WHY A TABLE AND NOT leads.notes
--
-- `leads.notes` is a single text column: last write wins, silently. Two people
-- working the same lead overwrite each other with no trace, and there is no way
-- to tell what was said when. On a lead that gets called five times over three
-- weeks — the normal real-estate case — that column is a running loss of
-- information.
--
-- Entries are append-only in the UI and carry their author. `leads.notes` is
-- left in place and still editable from the Details tab: it is the lead's
-- standing description, whereas these are dated observations. Merging the two
-- concepts is what produced the overwrite problem in the first place.
--
-- author_email is denormalised on purpose. auth.users rows can be removed, and
-- "who said this" is the half of a note that survives the person leaving.
-- =============================================================================

create table if not exists public.lead_notes (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  lead_id         uuid not null references public.leads (id) on delete cascade,

  author_id       uuid references auth.users (id) on delete set null,
  author_email    text,

  body            text not null check (char_length(body) between 1 and 5000),

  created_at      timestamptz not null default now()
);

-- The only access pattern: one lead's notes, newest first.
create index if not exists lead_notes_lead_created_idx
  on public.lead_notes (lead_id, created_at desc);
create index if not exists lead_notes_org_idx
  on public.lead_notes (organisation_id);

alter table public.lead_notes enable row level security;

drop policy if exists "lead_notes_select_own_org" on public.lead_notes;
create policy "lead_notes_select_own_org"
  on public.lead_notes for select
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

-- Insert is authenticated-direct (not service-role) so the note is attributed
-- to the real session user by the database, not by whatever the client claimed.
drop policy if exists "lead_notes_insert_own_org" on public.lead_notes;
create policy "lead_notes_insert_own_org"
  on public.lead_notes for insert
  to authenticated
  with check (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
    and author_id = (select auth.uid())
  );

-- Delete your own note only. No UPDATE policy at all: an editable note with a
-- fixed timestamp is a record that quietly disagrees with itself.
drop policy if exists "lead_notes_delete_own" on public.lead_notes;
create policy "lead_notes_delete_own"
  on public.lead_notes for delete
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
    and author_id = (select auth.uid())
  );

comment on table public.lead_notes is
  'Append-only, authored, timestamped notes on a lead. Distinct from '
  'leads.notes, which is the lead''s standing description.';
