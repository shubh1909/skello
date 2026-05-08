-- Profiles table + platform-admin flag.
--
-- Platform admin (Skelo staff) is a property of a user, not an organisation.
-- This table holds the flag and any future per-user app-level fields
-- (display name, preferences, etc.) that don't belong in auth.users.
--
-- RLS posture:
--   - A user may read and update their own profile row.
--   - No one may self-promote — the `is_admin` column is locked via a
--     WITH CHECK that requires the new value to equal the currently stored
--     value. Promotions/demotions happen through the service-role admin
--     client, invoked by an admin-gated Server Action.
--
-- Bootstrap: after running this migration, manually promote the first
-- admin via the Supabase SQL editor:
--
--   update public.profiles set is_admin = true where id = '<your user uuid>';
--
-- From then on, admins manage other admins through the admin panel.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Keep updated_at in sync via the shared trigger fn used elsewhere
-- (public.set_updated_at is defined in 20260420000000_create_organisations.sql).
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-provision a profile row on sign-up
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: any user who signed up before this migration needs a row.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

drop policy if exists "profiles_read_self" on public.profiles;
create policy "profiles_read_self"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

-- Users can edit display_name etc. but must NOT be able to flip is_admin.
-- The WITH CHECK locks is_admin to whatever's already stored for this row.
-- Admin flips happen via the service-role client from an admin action.
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and is_admin = (
      select is_admin from public.profiles where id = (select auth.uid())
    )
  );
