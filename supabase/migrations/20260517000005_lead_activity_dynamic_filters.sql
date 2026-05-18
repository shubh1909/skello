-- =============================================================================
-- Wave 2 — Extend lead_call_activity for dynamic-field filters, sort, search.
--
-- Filter shape (p_filters jsonb):
--   [
--     { "source": "lead_data" | "custom_data",
--       "category": "" | "<category>",
--       "key":    "<key_path>",
--       "op":     "eq" | "neq" | "contains" | "lt" | "lte" | "gt" | "gte",
--       "value":  <jsonb scalar> }
--   ]
--
-- Sort shape (p_sort_by jsonb, optional):
--   { "source": "lead_data" | "custom_data" | "column",
--     "category": "",
--     "key":    "<key_path or column_name>",
--     "dir":    "asc" | "desc",
--     "type":   "text" | "number" | "date" | "boolean" }
--
-- Search (p_search text, optional): full-text query against leads.search_tsv.
--
-- All filters AND together. Missing/unsupported ops short-circuit to ignored.
-- The function stays SECURITY INVOKER so RLS still gates cross-tenant reads.
-- =============================================================================

create or replace function public.lead_call_activity(
  p_org_id             uuid,
  p_org_slug           text,
  p_include_zero_calls boolean default false,
  p_limit              int default 10,
  p_offset             int default 0,
  p_filters            jsonb default '[]'::jsonb,
  p_sort_by            jsonb default null,
  p_search             text default null
)
returns table (
  id                          uuid,
  created_at                  timestamptz,
  updated_at                  timestamptz,
  organisation_id             uuid,
  org_slug                    text,
  name                        text,
  phone                        text,
  phone_normalized            text,
  first_seen_at               timestamptz,
  last_contact_at             timestamptz,
  current_intent              public.intent_type,
  city                        text,
  pincode                     text,
  notes                       text,
  source                      public.lead_source,
  status                      public.lead_status,
  pending_action              boolean,
  lead_data                   jsonb,
  custom_data                 jsonb,
  latest_call_interest        text,
  latest_call_summary         text,
  latest_call_recording_url   text,
  inbound_calls               bigint,
  outbound_calls              bigint,
  total_calls                 bigint,
  last_call_at                timestamptz,
  first_call_at               timestamptz,
  total_duration_seconds      bigint
)
language plpgsql
security invoker
stable
as $$
declare
  v_where         text := '';
  v_sort_clause   text := 'ca.total_calls desc nulls last, ca.last_call_at desc nulls last, l.created_at desc';
  v_filter        jsonb;
  v_source        text;
  v_category      text;
  v_key           text;
  v_op            text;
  v_value         jsonb;
  v_jsonb_path    text;
  v_text_expr     text;
  v_sort_source   text;
  v_sort_key      text;
  v_sort_cat      text;
  v_sort_dir      text;
  v_sort_type     text;
  v_sql           text;
begin
  -- Dynamic filter clauses. Each entry adds an AND condition. We refuse to
  -- inline raw `value` for non-eq ops because that would invite SQL injection
  -- — instead we cast a jsonb literal at execution time via a USING binding.
  -- For simplicity in v1, we inline the literal but escape it as a json string;
  -- Postgres parses the cast safely.
  if jsonb_typeof(coalesce(p_filters, '[]'::jsonb)) = 'array' then
    for v_filter in select * from jsonb_array_elements(p_filters)
    loop
      v_source   := coalesce(v_filter->>'source', 'lead_data');
      v_category := coalesce(v_filter->>'category', '');
      v_key      := v_filter->>'key';
      v_op       := lower(coalesce(v_filter->>'op', 'eq'));
      v_value    := v_filter->'value';
      if v_key is null or v_value is null then
        continue;
      end if;

      -- Path into the jsonb blob, e.g. l.lead_data->'interest' or
      -- l.custom_data->'preferences'->'budget'.
      if v_source = 'lead_data' then
        v_jsonb_path := format('l.lead_data->%L', v_key);
      elsif v_source = 'custom_data' then
        if v_category is null or v_category = '' then
          v_jsonb_path := format('l.custom_data->%L', v_key);
        else
          v_jsonb_path := format('l.custom_data->%L->%L', v_category, v_key);
        end if;
      else
        -- Unknown source — skip rather than fail.
        continue;
      end if;
      v_text_expr := v_jsonb_path || '#>>''{}''';

      if v_op = 'eq' then
        v_where := v_where || format(' and %s = %L::jsonb', v_jsonb_path, v_value::text);
      elsif v_op = 'neq' then
        v_where := v_where || format(' and (%s is null or %s <> %L::jsonb)', v_jsonb_path, v_jsonb_path, v_value::text);
      elsif v_op = 'contains' then
        v_where := v_where || format(' and %s ilike %L', v_text_expr, '%' || (v_value#>>'{}') || '%');
      elsif v_op in ('lt', 'lte', 'gt', 'gte') then
        v_where := v_where || format(' and (%s)::numeric %s %L::numeric', v_text_expr,
          case v_op when 'lt' then '<' when 'lte' then '<=' when 'gt' then '>' when 'gte' then '>=' end,
          v_value#>>'{}');
      end if;
    end loop;
  end if;

  -- Full-text search against leads.search_tsv.
  if p_search is not null and length(trim(p_search)) > 0 then
    v_where := v_where || format(
      ' and l.search_tsv @@ plainto_tsquery(''simple'', %L)',
      trim(p_search)
    );
  end if;

  -- Sort clause. Default sort is preserved when p_sort_by is null.
  if p_sort_by is not null and jsonb_typeof(p_sort_by) = 'object' then
    v_sort_source := coalesce(p_sort_by->>'source', 'column');
    v_sort_key    := p_sort_by->>'key';
    v_sort_cat    := coalesce(p_sort_by->>'category', '');
    v_sort_dir    := case lower(coalesce(p_sort_by->>'dir', 'desc'))
                       when 'asc' then 'asc' else 'desc' end;
    v_sort_type   := lower(coalesce(p_sort_by->>'type', 'text'));

    if v_sort_key is not null then
      if v_sort_source = 'column' then
        -- Allowlist of column-name sort targets to prevent injection.
        if v_sort_key in (
          'name', 'created_at', 'updated_at', 'last_contact_at',
          'first_seen_at', 'status', 'current_intent'
        ) then
          v_sort_clause := format('l.%I %s nulls last', v_sort_key, v_sort_dir);
        end if;
      elsif v_sort_source in ('lead_data', 'custom_data') then
        if v_sort_source = 'lead_data' then
          v_jsonb_path := format('l.lead_data->%L', v_sort_key);
        elsif v_sort_cat = '' then
          v_jsonb_path := format('l.custom_data->%L', v_sort_key);
        else
          v_jsonb_path := format('l.custom_data->%L->%L', v_sort_cat, v_sort_key);
        end if;
        v_text_expr := v_jsonb_path || '#>>''{}''';
        if v_sort_type = 'number' then
          v_sort_clause := format('(%s)::numeric %s nulls last', v_text_expr, v_sort_dir);
        elsif v_sort_type = 'date' then
          v_sort_clause := format('(%s)::timestamptz %s nulls last', v_text_expr, v_sort_dir);
        else
          v_sort_clause := format('%s %s nulls last', v_text_expr, v_sort_dir);
        end if;
      end if;
    end if;
  end if;

  v_sql := format($f$
    with call_aggs as (
      select
        l.id as lead_id,
        count(*) filter (where c.direction = 'inbound')  as inbound_calls,
        count(*) filter (where c.direction = 'outbound') as outbound_calls,
        count(c.id)                                      as total_calls,
        max(c.started_at)                                as last_call_at,
        min(c.started_at)                                as first_call_at,
        coalesce(sum(c.duration_seconds), 0)             as total_duration_seconds
      from public.leads l
      left join public.calls c on c.lead_id = l.id
      where l.organisation_id = %L
      group by l.id
    ),
    latest_call as (
      select distinct on (c.lead_id)
        c.lead_id,
        c.interest      as latest_call_interest,
        c.summary       as latest_call_summary,
        c.recording_url as latest_call_recording_url
      from public.calls c
      join public.leads l on l.id = c.lead_id
      where l.organisation_id = %L
      order by c.lead_id, c.started_at desc
    )
    select
      l.id, l.created_at, l.updated_at,
      l.organisation_id, l.org_slug,
      l.name, l.phone, l.phone_normalized,
      l.first_seen_at, l.last_contact_at,
      l.current_intent,
      l.city, l.pincode, l.notes,
      l.source, l.status, l.pending_action,
      l.lead_data, l.custom_data,
      lc.latest_call_interest,
      lc.latest_call_summary,
      lc.latest_call_recording_url,
      coalesce(ca.inbound_calls, 0)::bigint           as inbound_calls,
      coalesce(ca.outbound_calls, 0)::bigint          as outbound_calls,
      coalesce(ca.total_calls, 0)::bigint             as total_calls,
      ca.last_call_at,
      ca.first_call_at,
      coalesce(ca.total_duration_seconds, 0)::bigint  as total_duration_seconds
    from public.leads l
    left join call_aggs   ca on ca.lead_id = l.id
    left join latest_call lc on lc.lead_id = l.id
    where l.organisation_id = %L
      and (%L or coalesce(ca.total_calls, 0) > 0)
      %s
    order by %s
    limit %s offset %s
  $f$, p_org_id, p_org_id, p_org_id, p_include_zero_calls, v_where, v_sort_clause, p_limit, p_offset);

  return query execute v_sql;
end;
$$;

grant execute on function public.lead_call_activity(
  uuid, text, boolean, int, int, jsonb, jsonb, text
) to authenticated;

-- Count variant gets the same filter + search treatment so pagination totals
-- stay accurate when filters narrow the result set.
create or replace function public.lead_call_activity_count(
  p_org_id             uuid,
  p_org_slug           text,
  p_include_zero_calls boolean default false,
  p_filters            jsonb default '[]'::jsonb,
  p_search             text default null
)
returns bigint
language plpgsql
security invoker
stable
as $$
declare
  v_where     text := '';
  v_filter    jsonb;
  v_source    text;
  v_category  text;
  v_key       text;
  v_op        text;
  v_value     jsonb;
  v_jsonb_path text;
  v_text_expr text;
  v_sql       text;
  v_count     bigint;
begin
  if jsonb_typeof(coalesce(p_filters, '[]'::jsonb)) = 'array' then
    for v_filter in select * from jsonb_array_elements(p_filters)
    loop
      v_source   := coalesce(v_filter->>'source', 'lead_data');
      v_category := coalesce(v_filter->>'category', '');
      v_key      := v_filter->>'key';
      v_op       := lower(coalesce(v_filter->>'op', 'eq'));
      v_value    := v_filter->'value';
      if v_key is null or v_value is null then continue; end if;

      if v_source = 'lead_data' then
        v_jsonb_path := format('l.lead_data->%L', v_key);
      elsif v_source = 'custom_data' then
        if v_category = '' then
          v_jsonb_path := format('l.custom_data->%L', v_key);
        else
          v_jsonb_path := format('l.custom_data->%L->%L', v_category, v_key);
        end if;
      else continue;
      end if;
      v_text_expr := v_jsonb_path || '#>>''{}''';

      if v_op = 'eq' then
        v_where := v_where || format(' and %s = %L::jsonb', v_jsonb_path, v_value::text);
      elsif v_op = 'neq' then
        v_where := v_where || format(' and (%s is null or %s <> %L::jsonb)', v_jsonb_path, v_jsonb_path, v_value::text);
      elsif v_op = 'contains' then
        v_where := v_where || format(' and %s ilike %L', v_text_expr, '%' || (v_value#>>'{}') || '%');
      elsif v_op in ('lt', 'lte', 'gt', 'gte') then
        v_where := v_where || format(' and (%s)::numeric %s %L::numeric', v_text_expr,
          case v_op when 'lt' then '<' when 'lte' then '<=' when 'gt' then '>' when 'gte' then '>=' end,
          v_value#>>'{}');
      end if;
    end loop;
  end if;

  if p_search is not null and length(trim(p_search)) > 0 then
    v_where := v_where || format(
      ' and l.search_tsv @@ plainto_tsquery(''simple'', %L)',
      trim(p_search)
    );
  end if;

  v_sql := format($f$
    select count(*)::bigint
    from public.leads l
    where l.organisation_id = %L
      and (%L or exists (select 1 from public.calls c where c.lead_id = l.id))
      %s
  $f$, p_org_id, p_include_zero_calls, v_where);

  execute v_sql into v_count;
  return v_count;
end;
$$;

grant execute on function public.lead_call_activity_count(uuid, text, boolean, jsonb, text)
  to authenticated;
