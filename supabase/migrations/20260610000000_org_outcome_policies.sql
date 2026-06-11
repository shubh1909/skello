-- =============================================================================
-- 20260610000000 — Per-org configurable call-outcome & success policy.
-- =============================================================================
-- Disposition-based retry shipped with a HARDCODED decision table (which
-- call_outcome means succeed / fail / callback, and which count as a campaign
-- "success"). This makes that table per-org and admin-editable:
--
--   org_outcome_policies — one row per outcome, per org:
--     outcome_key        the (normalised) label the voice agent emits.
--     label              display name for the admin UI.
--     action             what the contact does:
--                          succeed  → terminal success (+ lead conversion)
--                          fail     → terminal, no retry
--                          callback → re-arm at requested time (callback budget)
--                          retry    → re-arm at the campaign retry interval
--     counts_as_success  whether it counts toward the campaign success rate
--                        (DECOUPLED from action — an org can mark a fail-action
--                        outcome as "reached / counts").
--     is_fallback        the one reserved row (no_decision) used when the agent
--                        emits a label not in this org's list. Non-deletable.
--
-- Because outcomes are now CUSTOM per org, the fixed-vocabulary CHECK added to
-- calls.call_outcome in 20260608000000 is dropped (custom labels would violate
-- it). Seeding reproduces today's exact 7-outcome behaviour so existing orgs
-- are unaffected. Append-only: earlier migrations are untouched.
-- =============================================================================

create table if not exists public.org_outcome_policies (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete cascade,
  outcome_key        text not null check (char_length(outcome_key) between 1 and 60),
  label              text not null check (char_length(label) between 1 and 80),
  action             text not null
                       check (action in ('succeed','fail','callback','retry')),
  counts_as_success  boolean not null default false,
  position           integer not null default 0,
  -- Exactly one fallback per org (the reserved no_decision row). Enforced by a
  -- partial unique index below; the create action never sets this.
  is_fallback        boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (organisation_id, outcome_key)
);

create index if not exists org_outcome_policies_org_idx
  on public.org_outcome_policies (organisation_id, position);

-- At most one fallback row per org.
create unique index if not exists org_outcome_policies_one_fallback
  on public.org_outcome_policies (organisation_id)
  where is_fallback;

drop trigger if exists org_outcome_policies_set_updated_at on public.org_outcome_policies;
create trigger org_outcome_policies_set_updated_at
  before update on public.org_outcome_policies
  for each row execute function public.set_updated_at();

alter table public.org_outcome_policies enable row level security;

-- Owners may read their org's policy (the app may surface it); all writes are
-- service-role only (the admin actions use the service-role client).
drop policy if exists "org_outcome_policies_select_own_org" on public.org_outcome_policies;
create policy "org_outcome_policies_select_own_org"
  on public.org_outcome_policies for select
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

-- -----------------------------------------------------------------------------
-- Seed today's behaviour for an org (no-op if it already has any policy).
-- -----------------------------------------------------------------------------
create or replace function public.seed_default_outcome_policies(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.org_outcome_policies where organisation_id = p_org_id
  ) then
    return;
  end if;

  insert into public.org_outcome_policies
    (organisation_id, outcome_key, label, action, counts_as_success, position, is_fallback)
  values
    (p_org_id, 'interested',         'Interested',          'succeed',  true,  0, false),
    (p_org_id, 'meeting_booked',     'Meeting booked',      'succeed',  true,  1, false),
    (p_org_id, 'callback_requested', 'Callback requested',  'callback', false, 2, false),
    (p_org_id, 'not_interested',     'Not interested',      'fail',     false, 3, false),
    (p_org_id, 'wrong_number',       'Wrong number',        'fail',     false, 4, false),
    (p_org_id, 'do_not_call',        'Do not call',         'fail',     false, 5, false),
    -- Reserved fallback: any label the agent emits that isn't configured above
    -- resolves to this. succeed + counts_as_success mirrors the old default
    -- (a connected call with no actionable disposition was a success).
    (p_org_id, 'no_decision',        'No clear decision',   'succeed',  true,  6, true);
end;
$$;

comment on function public.seed_default_outcome_policies(uuid) is
  'Seeds the 7 default call-outcome policies for an org (no-op if it already has any). Reproduces the pre-config hardcoded behaviour.';

create or replace function public.trg_seed_default_outcome_policies()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.seed_default_outcome_policies(new.id);
  return new;
end;
$$;

drop trigger if exists trg_org_seed_outcome_policies on public.organisations;
create trigger trg_org_seed_outcome_policies
  after insert on public.organisations
  for each row execute function public.trg_seed_default_outcome_policies();

-- Backfill existing orgs.
do $$
declare
  r record;
begin
  for r in select id from public.organisations loop
    perform public.seed_default_outcome_policies(r.id);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Custom outcomes are now allowed, so drop the fixed-vocabulary CHECK on calls.
-- The value is still stored verbatim; resolution happens against the per-org
-- policy at decision time.
-- -----------------------------------------------------------------------------
alter table public.calls
  drop constraint if exists calls_call_outcome_vocab;

comment on column public.calls.call_outcome is
  'Customer disposition extracted from the conversation, as a per-org outcome key (see org_outcome_policies). Free text now (no fixed vocabulary); resolved against the org policy to drive retry + success. NULL for inbound / un-extracted calls.';

-- Realtime not needed: the admin edits these, the decision engine reads them
-- via the service role. No client subscription.
