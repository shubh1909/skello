-- -----------------------------------------------------------------------------
-- campaign_best_dispositions
--
-- Returns the DISTINCT set of semantic call outcomes that actually occurred for
-- each of the given campaigns, by joining calls → campaign_contacts. The caller
-- (server action) ranks these against the org's outcome priority order to pick
-- the single "best" disposition per campaign — keeping the priority logic in
-- one place (app layer) so reordering outcomes never leaves a stale value here.
--
-- security definer: the campaigns list reads via the user's RLS client, but the
-- aggregation spans many contacts/calls. We bound it defensively to p_org_id so
-- a caller can never coax outcomes for a campaign outside their own org.
-- -----------------------------------------------------------------------------
create or replace function public.campaign_best_dispositions(
  p_org_id uuid,
  p_campaign_ids uuid[]
)
returns table (campaign_id uuid, outcome_key text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct cc.campaign_id, c.call_outcome as outcome_key
  from public.calls c
  join public.campaign_contacts cc on cc.id = c.campaign_contact_id
  where cc.campaign_id = any(p_campaign_ids)
    and cc.organisation_id = p_org_id
    and c.organisation_id = p_org_id
    and c.is_test = false
    and c.call_outcome is not null;
$$;

grant execute on function public.campaign_best_dispositions(uuid, uuid[])
  to authenticated;
