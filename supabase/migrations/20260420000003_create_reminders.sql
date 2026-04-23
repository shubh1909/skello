-- Reminders: follow-up tasks, scoped to an organisation and optionally linked to a lead.

create table if not exists public.reminders (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  lead_id          uuid references public.leads (id) on delete set null,
  created_by       uuid references auth.users (id) on delete set null,
  title            text not null check (char_length(title) between 1 and 200),
  notes            text,
  remind_at        timestamptz not null,
  type             text not null default 'other'
                   check (type in ('call', 'whatsapp', 'email', 'visit', 'other')),
  status           text not null default 'pending'
                   check (status in ('pending', 'done', 'dismissed')),
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists reminders_org_remind_at_idx
  on public.reminders (organisation_id, remind_at);
create index if not exists reminders_org_status_idx
  on public.reminders (organisation_id, status);
create index if not exists reminders_lead_idx
  on public.reminders (lead_id) where lead_id is not null;

drop trigger if exists reminders_set_updated_at on public.reminders;
create trigger reminders_set_updated_at
  before update on public.reminders
  for each row execute function public.set_updated_at();

alter table public.reminders enable row level security;

drop policy if exists "reminders_select_own_org" on public.reminders;
create policy "reminders_select_own_org"
  on public.reminders for select
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "reminders_insert_own_org" on public.reminders;
create policy "reminders_insert_own_org"
  on public.reminders for insert
  to authenticated
  with check (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "reminders_update_own_org" on public.reminders;
create policy "reminders_update_own_org"
  on public.reminders for update
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  )
  with check (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "reminders_delete_own_org" on public.reminders;
create policy "reminders_delete_own_org"
  on public.reminders for delete
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );
