-- =============================================================================
-- lead_status_counts — the funnel numbers on the /leads tab strip.
--
-- WHY A DEDICATED FUNCTION AND NOT SEVEN CALLS TO lead_call_activity_count
--
-- Seven calls would each rebuild the call-aggregate CTE over every call in the
-- org — on a 4,000-lead workspace with 6,400 calls that is seven full aggregate
-- scans on every page load, to render seven small numbers. One grouped query
-- does the same job once.
--
-- ⚠️ SCOPE: this deliberately does NOT take the table's dynamic filters or
-- search. Threading those through would mean a third copy of the ~80-line
-- filter-expression builder that `lead_call_activity{,_count}` already carry two
-- copies of, and the two would drift. The UI's contract instead is that the
-- counts describe the WORKSPACE, and it hides them entirely whenever a search
-- or filter is active rather than showing a number the table below disagrees
-- with. A tab reading "812" over a table of three rows is the same class of
-- bug as the dashboard's silently-capped 1,000.
--
-- SECURITY INVOKER: RLS on `leads` still applies to the caller, exactly as with
-- the equivalent hand-written query. The org filter here is the primary gate.
-- =============================================================================

create or replace function public.lead_status_counts(
  p_org_id             uuid,
  p_include_zero_calls boolean default false
)
returns table (
  status public.lead_status,
  total  bigint
)
language sql
security invoker
stable
as $$
  select l.status, count(*)::bigint
  from public.leads l
  where l.organisation_id = p_org_id
    -- RLS carries this too, but the function is also reachable by a
    -- service-role caller, where it would not.
    and l.deleted_at is null
    -- Mirrors the list RPC's `coalesce(ca.total_calls, 0) > 0`: any call row
    -- linked to the lead counts, soft-deleted or not, so the tab totals and the
    -- table agree on what "with calls" means.
    and (
      p_include_zero_calls
      or exists (select 1 from public.calls c where c.lead_id = l.id)
    )
  group by l.status;
$$;

comment on function public.lead_status_counts(uuid, boolean) is
  'Lead count per pipeline status for one organisation, for the /leads tab '
  'strip. Ignores the table''s dynamic filters and search by design — the UI '
  'hides the counts when either is active rather than showing a figure that '
  'disagrees with the rows below.';

grant execute on function public.lead_status_counts(uuid, boolean) to authenticated;

-- The exists() probe walks calls by lead_id; the aggregate walks leads by org.
create index if not exists calls_lead_id_idx on public.calls (lead_id)
  where lead_id is not null;

notify pgrst, 'reload schema';
