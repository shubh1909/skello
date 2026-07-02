-- =============================================================================
-- Realtime for the Cart Recovery dashboard — publish the two tables the
-- workspace tabs read so the browser gets postgres_changes as attempts + calls
-- move. RLS still gates delivery (owner-scoped selects), so a subscriber only
-- ever receives their own org's rows.
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shopify_recovery_attempts'
  ) then
    alter publication supabase_realtime add table public.shopify_recovery_attempts;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'calls'
  ) then
    alter publication supabase_realtime add table public.calls;
  end if;
end $$;
