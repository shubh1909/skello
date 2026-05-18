-- =============================================================================
-- Phase 0 — Voice Agent Registry.
--
-- Replaces fragile LLM-derived tenancy routing (extracted_data.business_slug)
-- with a deterministic (agent_id → organisation_id) lookup table. The agent_id
-- comes from the telephony provider on every webhook, so this is a trusted
-- gate rather than an LLM-emitted field.
--
-- Invariants:
--   - agent_id is the PRIMARY KEY → a single agent cannot belong to two orgs.
--   - Each row is "claimed" by exactly one organisation_id.
--   - bolna_integrations.agent_id and agent_ids[] are backfilled into this
--     table on apply. The bolna_integrations columns stay populated for one
--     release cycle (read-path compatibility) and are dropped in cleanup.
--
-- RLS:
--   - Org owners can read their own rows.
--   - Inserts/updates/deletes go through the service-role admin client; the
--     Server Action gates on userOwnsOrg before writing.
-- =============================================================================

create table if not exists public.voice_agents (
  agent_id         text primary key check (char_length(agent_id) between 1 and 200),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  label            text check (label is null or char_length(label) between 1 and 120),
  enabled          boolean not null default true,
  verified_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists voice_agents_org_idx
  on public.voice_agents (organisation_id);

drop trigger if exists voice_agents_set_updated_at on public.voice_agents;
create trigger voice_agents_set_updated_at
  before update on public.voice_agents
  for each row execute function public.set_updated_at();

alter table public.voice_agents enable row level security;

drop policy if exists "voice_agents_select_own_org" on public.voice_agents;
create policy "voice_agents_select_own_org"
  on public.voice_agents for select
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );
-- Writes are service-role only. Server Actions perform the auth check.

-- -----------------------------------------------------------------------------
-- Backfill from bolna_integrations.
--   - The default agent_id becomes a verified row (grandfathered).
--   - Each entry of agent_ids[] becomes a row labelled from agent_labels.
--   - Conflict on (agent_id) wins by earliest claim — but in practice an
--     agent_id appearing twice would already have been a bug.
-- -----------------------------------------------------------------------------

insert into public.voice_agents (agent_id, organisation_id, label, enabled, verified_at)
select
  bi.agent_id,
  bi.organisation_id,
  coalesce(bi.agent_labels ->> bi.agent_id, 'Default agent') as label,
  bi.enabled,
  bi.created_at
from public.bolna_integrations bi
where bi.agent_id is not null and length(trim(bi.agent_id)) > 0
on conflict (agent_id) do nothing;

insert into public.voice_agents (agent_id, organisation_id, label, enabled, verified_at)
select
  extra_id,
  bi.organisation_id,
  coalesce(bi.agent_labels ->> extra_id, extra_id) as label,
  bi.enabled,
  bi.created_at
from public.bolna_integrations bi
cross join lateral unnest(coalesce(bi.agent_ids, '{}'::text[])) as extra_id
where extra_id is not null and length(trim(extra_id)) > 0
on conflict (agent_id) do nothing;

-- -----------------------------------------------------------------------------
-- Resolver RPC — single source of truth for "given an agent_id, which org owns
-- it?" Used by the webhook routing layer in lib/bolna/routing.ts.
--   security definer: the webhook hits this via the admin (service-role)
--   client, but we still want the function to be callable from anonymous /
--   authenticated contexts in dev tools without leaking other orgs' rows —
--   it returns only the org id for the matched agent, never a list.
-- -----------------------------------------------------------------------------

create or replace function public.resolve_org_by_agent(p_agent_id text)
returns table (organisation_id uuid, enabled boolean)
language sql
security definer
stable
set search_path = public
as $$
  select organisation_id, enabled
  from public.voice_agents
  where agent_id = p_agent_id
  limit 1;
$$;

grant execute on function public.resolve_org_by_agent(text)
  to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Resolver RPC — DID fallback. Given the dialed number, return any orgs that
-- claim it via bolna_integrations (default or extras). Returns >1 row only if
-- two orgs misconfigured the same DID; the webhook treats that as ambiguous
-- and refuses to route.
-- -----------------------------------------------------------------------------

create or replace function public.resolve_org_by_dialed_number(p_to_number text)
returns table (organisation_id uuid)
language sql
security definer
stable
set search_path = public
as $$
  select organisation_id
  from public.bolna_integrations
  where from_phone_number = p_to_number
     or p_to_number = any(coalesce(from_phone_numbers, '{}'::text[]));
$$;

grant execute on function public.resolve_org_by_dialed_number(text)
  to anon, authenticated, service_role;
