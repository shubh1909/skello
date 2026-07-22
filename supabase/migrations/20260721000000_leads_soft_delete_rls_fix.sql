-- Fix: soft-deleted leads are still visible to authenticated users.
--
-- Background
-- ----------
-- `leads` is mid-migration between two tenancy keys and carries TWO permissive
-- SELECT policies:
--
--   leads_select_own_org       (20260623000001) — deleted_at is null AND org_slug in (...)
--   leads_select_own_org_by_id (20260517000003) — organisation_id in (...)   ← no deleted_at
--
-- Postgres OR's permissive policies for the same command, so a row is visible
-- if EITHER passes. The soft-delete migration (20260623000001) added the
-- `deleted_at is null` predicate to every table's SELECT policy, but on `leads`
-- it only recreated the slug-keyed one — the `_by_id` policy predates it and was
-- never revisited. Net effect: the `_by_id` policy alone re-exposes every
-- soft-deleted lead, defeating the guarantee 20260623000001 documents in its
-- own header. Every other soft-delete table has exactly one SELECT policy and
-- is unaffected.
--
-- Fix
-- ---
-- Add the missing predicate to the `_by_id` SELECT policy. Deliberately scoped:
--
--   - SELECT only. INSERT/UPDATE/DELETE on a soft-deleted row are not the leak,
--     and the app relies on being able to UPDATE `deleted_at` (both to soft-
--     delete and to restore). Adding the predicate to UPDATE would make a
--     soft-deleted lead unrestorable through the cookie client.
--   - Both policies are kept. Dropping either one silently changes visibility
--     for rows where `organisation_id` and `org_slug` disagree — the dual-key
--     transition is not finished, and consolidating it is a separate change.
--
-- Note this only restores the RLS-layer guarantee. `createAdminClient()`
-- bypasses RLS entirely, so service-role paths must still filter
-- `deleted_at is null` by hand.

drop policy if exists "leads_select_own_org_by_id" on public.leads;
create policy "leads_select_own_org_by_id"
  on public.leads for select
  to authenticated
  using (
    deleted_at is null
    and organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );
