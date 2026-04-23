-- Leads RLS policies.
--
-- The original `20260420000001_create_leads.sql` never enabled RLS or added
-- policies. If RLS later gets enabled (e.g. via the Supabase dashboard) without
-- policies, every write fails with "new row violates row-level security
-- policy". This migration makes the policy state explicit and aligned with
-- the reminders/organisations pattern.
--
-- Tenant scoping is via `org_slug` because leads.org_slug -> organisations.slug.

alter table public.leads enable row level security;

drop policy if exists "leads_select_own_org" on public.leads;
create policy "leads_select_own_org"
  on public.leads for select
  to authenticated
  using (
    org_slug in (
      select slug from public.organisations
      where owner_id = (select auth.uid())
    )
  );

drop policy if exists "leads_insert_own_org" on public.leads;
create policy "leads_insert_own_org"
  on public.leads for insert
  to authenticated
  with check (
    org_slug in (
      select slug from public.organisations
      where owner_id = (select auth.uid())
    )
  );

drop policy if exists "leads_update_own_org" on public.leads;
create policy "leads_update_own_org"
  on public.leads for update
  to authenticated
  using (
    org_slug in (
      select slug from public.organisations
      where owner_id = (select auth.uid())
    )
  )
  with check (
    org_slug in (
      select slug from public.organisations
      where owner_id = (select auth.uid())
    )
  );

drop policy if exists "leads_delete_own_org" on public.leads;
create policy "leads_delete_own_org"
  on public.leads for delete
  to authenticated
  using (
    org_slug in (
      select slug from public.organisations
      where owner_id = (select auth.uid())
    )
  );
