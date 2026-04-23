-- Organisations: tenant root. Every downstream row is scoped to organisation_id.

create extension if not exists "pgcrypto";

create table if not exists public.organisations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 100),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists organisations_owner_id_idx on public.organisations (owner_id);

-- Keep updated_at honest
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists organisations_set_updated_at on public.organisations;
create trigger organisations_set_updated_at
  before update on public.organisations
  for each row execute function public.set_updated_at();

-- RLS: app-layer always scopes queries, but RLS is the safety net.
alter table public.organisations enable row level security;

drop policy if exists "organisations_select_own" on public.organisations;
create policy "organisations_select_own"
  on public.organisations for select
  to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "organisations_insert_own" on public.organisations;
create policy "organisations_insert_own"
  on public.organisations for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists "organisations_update_own" on public.organisations;
create policy "organisations_update_own"
  on public.organisations for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "organisations_delete_own" on public.organisations;
create policy "organisations_delete_own"
  on public.organisations for delete
  to authenticated
  using (owner_id = (select auth.uid()));
