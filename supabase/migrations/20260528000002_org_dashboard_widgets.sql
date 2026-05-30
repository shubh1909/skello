-- =============================================================================
-- 20260528000002 — Per-org configurable dashboards.
-- =============================================================================
-- Platform admins can compose each org's dashboard from a curated set of
-- "widgets" (stat cards, bar / pie / line charts, pivot tables). Each
-- widget is a small JSONB config describing source table, metric,
-- dimensions, filters, time bucket, and chart type. The widget is
-- executed via `execute_dashboard_widget(p_org_id, p_config)`, which
-- compiles the config into a constrained SQL query — no admin-supplied
-- SQL ever touches Postgres directly.
--
-- Safety model:
--   * `source` is one of three allowlisted tables.
--   * `metric.op` is one of six allowlisted aggregations.
--   * Column dimensions (source = 'column') are checked against a
--     per-source allowlist of identifiers.
--   * JSONB-key dimensions (lead_data / custom_data) use `%L` quoting
--     so an arbitrary key string can't break out of the literal slot.
--   * Filter operators reuse the same set as `lead_call_activity`.
--   * Multi-tenancy is enforced by an always-present
--     `organisation_id = p_org_id` predicate.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (1) org_dashboard_widgets — the per-org widget catalogue.
-- -----------------------------------------------------------------------------

create table if not exists public.org_dashboard_widgets (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  position        integer not null default 0,
  enabled         boolean not null default true,
  title           text not null check (char_length(title) between 1 and 120),
  -- Compiled by execute_dashboard_widget(). Shape validated server-side
  -- via Zod before insert/update; the SQL allowlists below are the
  -- last line of defence if a buggy client sneaks something through.
  config          jsonb not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.org_dashboard_widgets is
  'Per-org dashboard widget config. Managed by platform admins via /admin/organisations/[id]/dashboard. Rendered by the org owner''s dashboard page via execute_dashboard_widget().';

create index if not exists org_dashboard_widgets_org_position_idx
  on public.org_dashboard_widgets (organisation_id, position);

-- updated_at touch — same convention as the rest of the schema.
create or replace function public.org_dashboard_widgets_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_org_dashboard_widgets_updated_at
  on public.org_dashboard_widgets;
create trigger trg_org_dashboard_widgets_updated_at
  before update on public.org_dashboard_widgets
  for each row execute function public.org_dashboard_widgets_touch_updated_at();

-- RLS: org owners can READ their widgets (dashboard render path). Only
-- service_role (used by admin actions) can write. This keeps the
-- "platform admin configures" model intact even if a future bug exposes
-- the table to authenticated.
alter table public.org_dashboard_widgets enable row level security;

drop policy if exists org_dashboard_widgets_read_own
  on public.org_dashboard_widgets;
create policy org_dashboard_widgets_read_own
  on public.org_dashboard_widgets
  for select
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policies → only service_role can mutate.

-- -----------------------------------------------------------------------------
-- (2) execute_dashboard_widget(p_org_id, p_config)
-- -----------------------------------------------------------------------------
-- Compiles a widget JSONB config to a parameterised SQL query and
-- executes it. Returns a fixed 3-column shape:
--   * dim_a  — first dimension (e.g. category for bar / pie, period for
--              line, row for pivot). NULL for stat cards.
--   * dim_b  — second dimension (column for pivot). NULL otherwise.
--   * value  — numeric aggregation result.
--
-- The fixed shape lets every chart renderer share one row contract;
-- the renderer decides how to interpret the columns.
--
-- security invoker (not definer) — the function runs as the caller, so
-- RLS on the source tables (leads, calls, campaigns) still gates what
-- the caller can read. The admin path bypasses RLS by using the admin
-- client anyway; the org-owner render path benefits from the extra
-- belt-and-braces check.
-- -----------------------------------------------------------------------------

create or replace function public.execute_dashboard_widget(
  p_org_id  uuid,
  p_config  jsonb
)
returns table (
  dim_a  text,
  dim_b  text,
  value  numeric
)
language plpgsql
security invoker
stable
as $$
declare
  v_source       text   := lower(coalesce(p_config->>'source', ''));
  v_metric_op    text   := lower(coalesce(p_config->'metric'->>'op', 'count'));
  v_metric_col   text   := p_config->'metric'->>'column';
  v_range        text   := lower(coalesce(p_config->>'range', 'last_30_days'));
  v_filters      jsonb  := coalesce(p_config->'filters', '[]'::jsonb);
  v_dim_a        jsonb  := p_config->'row_dimension';
  v_dim_b        jsonb  := p_config->'column_dimension';
  v_date_col     text;
  v_from_iso     timestamptz;
  v_metric_expr  text;
  v_dim_a_expr   text;
  v_dim_b_expr   text;
  v_where        text   := '';
  v_group_by     text   := '';
  v_filter       jsonb;
  v_fsource      text;
  v_fkey         text;
  v_fcat         text;
  v_fop          text;
  v_fval         jsonb;
  v_fpath        text;
  v_ftext        text;
  v_sql          text;
begin
  -- ----- (a) Source allowlist -------------------------------------------
  if v_source not in ('leads', 'calls', 'campaigns') then
    raise exception 'Unsupported source: %', v_source
      using errcode = '22023';
  end if;

  v_date_col := case v_source
    when 'calls' then 'started_at'
    else 'created_at'
  end;

  -- ----- (b) Metric op allowlist + expression ---------------------------
  if v_metric_op not in
       ('count', 'count_distinct', 'sum', 'avg', 'min', 'max') then
    raise exception 'Unsupported metric op: %', v_metric_op
      using errcode = '22023';
  end if;

  if v_metric_op = 'count' then
    v_metric_expr := 'count(*)';
  elsif v_metric_op = 'count_distinct' then
    if not metric_column_allowed(v_source, v_metric_col) then
      raise exception 'Column % not allowed as metric for %',
        v_metric_col, v_source using errcode = '22023';
    end if;
    v_metric_expr := format('count(distinct %I)', v_metric_col);
  else
    if not metric_column_allowed(v_source, v_metric_col) then
      raise exception 'Column % not allowed as metric for %',
        v_metric_col, v_source using errcode = '22023';
    end if;
    v_metric_expr := format('%s(%I)', v_metric_op, v_metric_col);
  end if;

  -- ----- (c) Dimensions -------------------------------------------------
  v_dim_a_expr := dimension_expr(v_source, v_dim_a);
  v_dim_b_expr := dimension_expr(v_source, v_dim_b);

  -- ----- (d) WHERE: tenant + test-exclusion + range + filters -----------
  v_where := format(' where organisation_id = %L', p_org_id);

  -- Exclude test calls by default for the calls source. Real-call
  -- counts are the always-intended metric; matches the same filter
  -- baked into getLeadCallLifetimeStats.
  if v_source = 'calls' then
    v_where := v_where || ' and is_test = false';
  end if;

  -- Range filter on the source's primary date column.
  v_from_iso := range_to_from(v_range);
  if v_from_iso is not null then
    v_where := v_where || format(' and %I >= %L', v_date_col, v_from_iso);
  end if;

  -- Per-widget filter clauses (reuses the lead_call_activity shape).
  if jsonb_typeof(v_filters) = 'array' then
    for v_filter in select * from jsonb_array_elements(v_filters)
    loop
      v_fsource := coalesce(v_filter->>'source', 'column');
      v_fcat    := coalesce(v_filter->>'category', '');
      v_fkey    := v_filter->>'key';
      v_fop     := lower(coalesce(v_filter->>'op', 'eq'));
      v_fval    := v_filter->'value';
      if v_fkey is null or v_fval is null then continue; end if;

      -- Resolve the path expression for this filter.
      if v_fsource = 'column' then
        if not filter_column_allowed(v_source, v_fkey) then
          continue;
        end if;
        v_fpath := format('%I', v_fkey);
        v_ftext := v_fpath || '::text';
      elsif v_fsource = 'lead_data' and v_source = 'leads' then
        v_fpath := format('lead_data->%L', v_fkey);
        v_ftext := v_fpath || '#>>''{}''';
      elsif v_fsource = 'custom_data' and v_source = 'leads' then
        if v_fcat is null or v_fcat = '' then
          v_fpath := format('custom_data->%L', v_fkey);
        else
          v_fpath := format('custom_data->%L->%L', v_fcat, v_fkey);
        end if;
        v_ftext := v_fpath || '#>>''{}''';
      else
        -- Unknown filter source for this table — skip.
        continue;
      end if;

      if v_fop = 'eq' then
        if v_fsource in ('lead_data', 'custom_data') then
          v_where := v_where ||
            format(' and %s = %L::jsonb', v_fpath, v_fval::text);
        else
          v_where := v_where ||
            format(' and %s::text = %L', v_fpath, v_fval#>>'{}');
        end if;
      elsif v_fop = 'neq' then
        if v_fsource in ('lead_data', 'custom_data') then
          v_where := v_where ||
            format(' and (%s is null or %s <> %L::jsonb)',
                   v_fpath, v_fpath, v_fval::text);
        else
          v_where := v_where ||
            format(' and (%s is null or %s::text <> %L)',
                   v_fpath, v_fpath, v_fval#>>'{}');
        end if;
      elsif v_fop = 'contains' then
        v_where := v_where ||
          format(' and %s ilike %L', v_ftext,
                 '%' || (v_fval#>>'{}') || '%');
      elsif v_fop in ('lt', 'lte', 'gt', 'gte') then
        if v_fsource = 'column'
           and v_fkey in ('created_at', 'updated_at', 'started_at') then
          -- Date/timestamp columns must compare as timestamptz; casting a
          -- timestamp to numeric errors out. The builder hands these a
          -- datetime-local value (e.g. '2026-05-30T10:00').
          v_where := v_where ||
            format(' and %I %s %L::timestamptz', v_fkey,
                   case v_fop when 'lt' then '<' when 'lte' then '<='
                              when 'gt' then '>' when 'gte' then '>=' end,
                   v_fval#>>'{}');
        else
          v_where := v_where ||
            format(' and (%s)::numeric %s %L::numeric', v_ftext,
                   case v_fop when 'lt' then '<' when 'lte' then '<='
                              when 'gt' then '>' when 'gte' then '>=' end,
                   v_fval#>>'{}');
        end if;
      end if;
    end loop;
  end if;

  -- ----- (e) GROUP BY (only for non-NULL dimensions) --------------------
  if v_dim_a_expr <> 'null::text' or v_dim_b_expr <> 'null::text' then
    v_group_by := ' group by ';
    if v_dim_a_expr <> 'null::text' and v_dim_b_expr <> 'null::text' then
      v_group_by := v_group_by || '1, 2';
    elsif v_dim_a_expr <> 'null::text' then
      v_group_by := v_group_by || '1';
    else
      v_group_by := v_group_by || '2';
    end if;
  end if;

  -- ----- (f) Final query ------------------------------------------------
  v_sql := format(
    'select %s::text as dim_a, %s::text as dim_b, %s::numeric as value '
    || 'from public.%I %s%s order by 1 nulls last, 2 nulls last '
    || 'limit 5000',
    v_dim_a_expr,
    v_dim_b_expr,
    v_metric_expr,
    v_source,
    v_where,
    v_group_by
  );

  return query execute v_sql;
end;
$$;

-- -----------------------------------------------------------------------------
-- (3) Helper: dimension_expr(source, dimension_jsonb) -> text SQL expression
-- -----------------------------------------------------------------------------
-- Returns the SQL expression for a dimension, or the literal 'null::text'
-- when the dimension is absent. Handles:
--   * source='column' with per-table allowlist
--   * source='lead_data' / 'custom_data' (leads only) via JSONB key
--   * optional `bucket` ∈ ('day','week','month') for date columns
--     and timestamp-typed JSONB values (date_trunc).
-- -----------------------------------------------------------------------------

create or replace function public.dimension_expr(
  p_source     text,
  p_dim        jsonb
)
returns text
language plpgsql
immutable
as $$
declare
  v_src     text;
  v_key     text;
  v_cat     text;
  v_bucket  text;
  v_expr    text;
begin
  if p_dim is null or jsonb_typeof(p_dim) <> 'object' then
    return 'null::text';
  end if;

  v_src    := coalesce(p_dim->>'source', 'column');
  v_key    := p_dim->>'key';
  v_cat    := coalesce(p_dim->>'category', '');
  v_bucket := lower(coalesce(p_dim->>'bucket', ''));

  if v_key is null then return 'null::text'; end if;

  if v_src = 'column' then
    if not dimension_column_allowed(p_source, v_key) then
      return 'null::text';
    end if;
    if v_bucket in ('day', 'week', 'month')
       and v_key in ('created_at', 'started_at', 'updated_at') then
      v_expr := format(
        'to_char(date_trunc(%L, %I), %L)',
        v_bucket, v_key, 'YYYY-MM-DD'
      );
    else
      v_expr := format('%I::text', v_key);
    end if;
  elsif v_src = 'lead_data' and p_source = 'leads' then
    v_expr := format('lead_data->>%L', v_key);
  elsif v_src = 'custom_data' and p_source = 'leads' then
    if v_cat = '' then
      v_expr := format('custom_data->>%L', v_key);
    else
      v_expr := format('custom_data->%L->>%L', v_cat, v_key);
    end if;
  else
    return 'null::text';
  end if;

  return v_expr;
end;
$$;

-- -----------------------------------------------------------------------------
-- (4) Per-source column allowlists.
-- -----------------------------------------------------------------------------
-- Three helper predicates, one per role:
--   * dimension_column_allowed — what can be GROUPed BY
--   * filter_column_allowed    — what can appear in a WHERE filter
--   * metric_column_allowed    — what can be summed / averaged / etc.
-- Kept narrow on purpose; expand deliberately as new widgets need them.
-- -----------------------------------------------------------------------------

create or replace function public.dimension_column_allowed(
  p_source text,
  p_col    text
) returns boolean language sql immutable as $$
  select case p_source
    when 'leads' then p_col in (
      'status', 'current_intent', 'source', 'pending_action',
      'city', 'pincode', 'created_at', 'updated_at'
    )
    when 'calls' then p_col in (
      'direction', 'status', 'agent_id', 'language',
      'lead_intent_extracted', 'customer_status',
      'started_at'
    )
    when 'campaigns' then p_col in (
      'status', 'created_at'
    )
    else false
  end;
$$;

create or replace function public.filter_column_allowed(
  p_source text,
  p_col    text
) returns boolean language sql immutable as $$
  select case p_source
    when 'leads' then p_col in (
      'status', 'current_intent', 'source', 'pending_action',
      'city', 'pincode', 'created_at', 'updated_at'
    )
    when 'calls' then p_col in (
      'direction', 'status', 'agent_id', 'language',
      'lead_intent_extracted', 'customer_status',
      'duration_seconds', 'started_at'
    )
    when 'campaigns' then p_col in (
      'status', 'created_at',
      'total_contacts', 'valid_contacts',
      'succeeded_count', 'failed_count', 'in_flight_count'
    )
    else false
  end;
$$;

create or replace function public.metric_column_allowed(
  p_source text,
  p_col    text
) returns boolean language sql immutable as $$
  select case p_source
    when 'leads' then p_col in ('id', 'phone_normalized')
    when 'calls' then p_col in (
      'id', 'lead_id', 'agent_id', 'duration_seconds'
    )
    when 'campaigns' then p_col in (
      'id', 'total_contacts', 'valid_contacts',
      'succeeded_count', 'failed_count', 'in_flight_count'
    )
    else false
  end;
$$;

-- -----------------------------------------------------------------------------
-- (5) Range helper — translate a preset string into a "from" timestamp.
-- -----------------------------------------------------------------------------

create or replace function public.range_to_from(p_range text)
returns timestamptz
language sql
immutable
as $$
  select case lower(coalesce(p_range, ''))
    when 'last_7_days'  then now() - interval '7 days'
    when 'last_30_days' then now() - interval '30 days'
    when 'last_90_days' then now() - interval '90 days'
    when 'last_180_days' then now() - interval '180 days'
    when 'last_365_days' then now() - interval '365 days'
    when 'all' then null
    else now() - interval '30 days'
  end;
$$;

-- -----------------------------------------------------------------------------
-- (6) Grants. The execution RPC is callable by authenticated users
--     (the dashboard render path). Helpers are internal.
-- -----------------------------------------------------------------------------

-- The main RPC runs as security invoker so RLS on the source tables
-- (leads, calls, campaigns) still applies as belt-and-braces. The
-- helper allowlist predicates and range translator must therefore be
-- callable by `authenticated` too, because the PL/pgSQL body calls
-- them in the caller's session. They're pure deterministic read-only
-- helpers with no side effects, so exposing them is harmless.
grant execute on function
  public.execute_dashboard_widget(uuid, jsonb),
  public.dimension_expr(text, jsonb),
  public.dimension_column_allowed(text, text),
  public.filter_column_allowed(text, text),
  public.metric_column_allowed(text, text),
  public.range_to_from(text)
  to authenticated, service_role;
