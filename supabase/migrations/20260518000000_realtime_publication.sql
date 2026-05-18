-- Publish the lead-pipeline tables to supabase_realtime so the existing
-- useLeadsRealtime / useCallsRealtime hooks actually receive events.
--
-- The subscriptions are filtered by org_slug / organisation_id in the client
-- and RLS still gates which rows the listener can see, so cross-tenant leaks
-- are not possible from this publication alone.
--
-- Wrapped in DO blocks so re-runs (and projects where the table is already
-- in the publication) don't error.

do $$
begin
  begin
    alter publication supabase_realtime add table public.leads;
  exception when duplicate_object then null;
  end;
end $$;

do $$
begin
  begin
    alter publication supabase_realtime add table public.calls;
  exception when duplicate_object then null;
  end;
end $$;

do $$
begin
  begin
    alter publication supabase_realtime add table public.call_transcripts;
  exception when duplicate_object then null;
  end;
end $$;
