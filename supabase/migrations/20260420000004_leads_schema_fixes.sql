-- Fixes for leads table:
--   1. Drop the accidental `unique (org_slug)` that limited 1 lead per org.
--   2. Add `external_id` for webhook idempotency (Bolna call_id).
--   3. Backfill-safe FK from leads.org_slug -> organisations.slug.
--   4. Add `updated_at` with trigger.

-- 1. Drop the broken unique constraint (allows many leads per org)
alter table public.leads drop constraint if exists leads_org_slug_key;

-- 2. Idempotency key for Bolna webhook retries
alter table public.leads add column if not exists external_id text;

-- Unique per-org external_id; NULL external_ids don't conflict (partial index).
create unique index if not exists leads_org_external_idx
  on public.leads (org_slug, external_id)
  where external_id is not null;

-- 3. Referential integrity: org_slug must point at a real organisation.
-- Wipe any orphan rows first so the constraint can be added.
delete from public.leads
  where org_slug is not null
    and org_slug not in (select slug from public.organisations);

alter table public.leads drop constraint if exists leads_org_slug_fkey;
alter table public.leads
  add constraint leads_org_slug_fkey
  foreign key (org_slug) references public.organisations (slug)
  on update cascade
  on delete cascade;

-- 4. updated_at + trigger. Ensure the trigger function exists even if the
-- organisations migration was applied outside this history.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

alter table public.leads add column if not exists updated_at timestamptz not null default now();

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- Helpful indexes for dashboard queries
create index if not exists leads_org_slug_created_at_idx
  on public.leads (org_slug, created_at desc);
