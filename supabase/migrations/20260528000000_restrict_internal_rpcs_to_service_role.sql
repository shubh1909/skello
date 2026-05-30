-- =============================================================================
-- 20260528000000 — Restrict internal RPCs to service_role only.
-- =============================================================================
-- These three RPCs were originally granted to `anon, authenticated,
-- service_role` to keep their original deployment simple, but each one
-- leaks tenant-shape information to any caller who can hit Postgrest:
--
--   * resolve_org_by_agent(text)           -- maps agent_id   → organisation_id
--   * resolve_org_by_dialed_number(text)   -- maps DID number → organisation_id
--   * lead_locked_fields(uuid)             -- returns locked-field set for a lead
--
-- All three are called only from server-side code paths that already use
-- the service-role admin client (the Bolna webhooks and the lead-merge
-- helper). Restricting the grant to `service_role` removes the public
-- enumeration surface — an `anon` caller with the public anon key can no
-- longer probe agent_id / DID / lead_id values to discover which tenant
-- they belong to.
--
-- This migration only changes grants; no function bodies are touched, so
-- it's safe to roll forward without coordinating a deploy.
-- =============================================================================

revoke execute on function public.resolve_org_by_agent(text)
  from anon, authenticated;

revoke execute on function public.resolve_org_by_dialed_number(text)
  from anon, authenticated;

revoke execute on function public.lead_locked_fields(uuid)
  from anon, authenticated;

-- service_role retains its grant from the original migrations (Postgres
-- doesn't strip grants we didn't explicitly revoke), so the webhooks and
-- lead-merge path keep working unchanged.
