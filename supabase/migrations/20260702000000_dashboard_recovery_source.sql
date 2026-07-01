-- =============================================================================
-- Admin analytics builder — add a "recovery" source (Shopify cart recovery).
--   The logical source `recovery` maps to the physical table
--   `shopify_recovery_attempts`. We re-declare the widget execution RPC + the
--   dimension/allowlist helpers (create-or-replace preserves grants) to teach
--   them the new source and its columns, plus handle `converted_at` as a
--   bucketable / comparable timestamp.
--   Mirrors the TS catalog in src/actions/admin/dashboard-catalog.ts.
-- =============================================================================

-- (1) Execution RPC — add the source, map it to its table, allow converted_at
--     in range/date comparisons.
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
  v_table        text;
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
  if v_source not in ('leads', 'calls', 'campaigns', 'recovery') then
    raise exception 'Unsupported source: %', v_source
      using errcode = '22023';
  end if;

  -- Logical source -> physical table. All others are 1:1 with their table.
  v_table := case v_source
    when 'recovery' then 'shopify_recovery_attempts'
    else v_source
  end;

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

  if v_source = 'calls' then
    v_where := v_where || ' and is_test = false';
  end if;

  v_from_iso := range_to_from(v_range);
  if v_from_iso is not null then
    v_where := v_where || format(' and %I >= %L', v_date_col, v_from_iso);
  end if;

  if jsonb_typeof(v_filters) = 'array' then
    for v_filter in select * from jsonb_array_elements(v_filters)
    loop
      v_fsource := coalesce(v_filter->>'source', 'column');
      v_fcat    := coalesce(v_filter->>'category', '');
      v_fkey    := v_filter->>'key';
      v_fop     := lower(coalesce(v_filter->>'op', 'eq'));
      v_fval    := v_filter->'value';
      if v_fkey is null or v_fval is null then continue; end if;

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
           and v_fkey in ('created_at', 'updated_at', 'started_at',
                          'converted_at') then
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
    v_table,
    v_where,
    v_group_by
  );

  return query execute v_sql;
end;
$$;

-- (2) dimension_expr — allow bucketing on converted_at too.
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
       and v_key in ('created_at', 'started_at', 'updated_at',
                     'converted_at') then
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

-- (3) Per-source allowlists — add the recovery columns.
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
    when 'recovery' then p_col in (
      'status', 'skip_reason', 'currency', 'created_at', 'converted_at'
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
    when 'recovery' then p_col in (
      'status', 'skip_reason', 'currency', 'marketing_consent',
      'cart_total', 'created_at', 'converted_at'
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
    when 'recovery' then p_col in (
      'id', 'cart_total', 'attempt'
    )
    else false
  end;
$$;
