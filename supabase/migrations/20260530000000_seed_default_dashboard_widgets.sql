-- =============================================================================
-- 20260530000000 — Seed a starter set of dashboard widgets for every org.
-- =============================================================================
-- Every organisation should land on a useful dashboard from day one instead
-- of the "no widgets configured" empty state. We seed a small, safe set of
-- widgets built entirely from first-class catalogue columns (so they render
-- for any org regardless of its custom fields). These are ordinary rows — a
-- platform admin can edit, hide, reorder, or delete any of them later.
--
-- Seeding is idempotent: it only fires when the org currently has zero
-- widgets, so the backfill below never duplicates, and an admin who deletes
-- the defaults won't see them resurrected.
-- =============================================================================

create or replace function public.seed_default_dashboard_widgets(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Only seed an empty dashboard. Keeps the backfill safe for orgs that
  -- already configured widgets, and avoids re-adding intentionally
  -- deleted defaults.
  if exists (
    select 1 from public.org_dashboard_widgets where organisation_id = p_org_id
  ) then
    return;
  end if;

  -- One JSONB literal per widget. (Concatenation would be `text`, which
  -- won't assign to a jsonb column without a cast, so each is a single
  -- literal cast to jsonb.)
  insert into public.org_dashboard_widgets
    (organisation_id, position, enabled, title, config)
  values
    (p_org_id, 0, true, 'Total leads',
      '{"kind":"builder","source":"leads","metric":{"op":"count"},"range":"all","filters":[],"chart_type":"stat_card"}'::jsonb),
    (p_org_id, 1, true, 'Leads by status',
      '{"kind":"builder","source":"leads","metric":{"op":"count"},"row_dimension":{"source":"column","key":"status"},"range":"last_90_days","filters":[],"chart_type":"bar"}'::jsonb),
    (p_org_id, 2, true, 'Leads by source',
      '{"kind":"builder","source":"leads","metric":{"op":"count"},"row_dimension":{"source":"column","key":"source"},"range":"last_90_days","filters":[],"chart_type":"pie"}'::jsonb),
    (p_org_id, 3, true, 'New leads over time',
      '{"kind":"builder","source":"leads","metric":{"op":"count"},"row_dimension":{"source":"column","key":"created_at","bucket":"day"},"range":"last_30_days","filters":[],"chart_type":"line"}'::jsonb),
    (p_org_id, 4, true, 'Calls by direction',
      '{"kind":"builder","source":"calls","metric":{"op":"count"},"row_dimension":{"source":"column","key":"direction"},"range":"last_90_days","filters":[],"chart_type":"bar"}'::jsonb),
    (p_org_id, 5, true, 'Calls over time',
      '{"kind":"builder","source":"calls","metric":{"op":"count"},"row_dimension":{"source":"column","key":"started_at","bucket":"day"},"range":"last_30_days","filters":[],"chart_type":"line"}'::jsonb);
end;
$$;

comment on function public.seed_default_dashboard_widgets(uuid) is
  'Seeds the starter dashboard widgets for an org (no-op if it already has any).';

-- Fire on org creation. SECURITY DEFINER so it can insert into
-- org_dashboard_widgets (service-role-write only) regardless of which role
-- created the organisation row.
create or replace function public.trg_seed_default_dashboard_widgets()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.seed_default_dashboard_widgets(new.id);
  return new;
end;
$$;

drop trigger if exists trg_org_seed_dashboard_widgets on public.organisations;
create trigger trg_org_seed_dashboard_widgets
  after insert on public.organisations
  for each row execute function public.trg_seed_default_dashboard_widgets();

-- Backfill existing orgs that have no widgets yet.
do $$
declare
  r record;
begin
  for r in select id from public.organisations loop
    perform public.seed_default_dashboard_widgets(r.id);
  end loop;
end;
$$;
