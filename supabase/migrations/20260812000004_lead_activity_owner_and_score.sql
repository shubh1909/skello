-- =============================================================================
-- 20260812000004 — lead_call_activity: return, filter and sort the two new
-- first-class columns (current_intent_score, owner_label).
--
-- WHY THIS IS NOT OPTIONAL
--
-- 20260812000003 registered both columns in lead_field_definitions. That
-- catalog drives three surfaces at once: the leads-table column manager, the
-- filter/sort builder, AND the new lead-sheet binding picker. Registering a
-- column the RPC does not return would give admins a switch that turns on an
-- always-blank column and a filter that silently matches nothing — the RPC's
-- `column` allowlist `continue`s past unknown keys rather than erroring.
--
-- Postgres requires DROP + CREATE when a function's RETURN shape changes;
-- CREATE OR REPLACE only tolerates an identical signature. The count function's
-- shape is unchanged (still bigint), so it is replaced in place — only its
-- allowlists move.
--
-- Body is 20260527000001 verbatim apart from the marked additions. It is copied
-- rather than patched because there is no way to append to a function body.
-- =============================================================================

drop function if exists public.lead_call_activity(
  uuid, text, boolean, int, int, jsonb, jsonb, text, timestamptz, timestamptz
);

create or replace function public.lead_call_activity(
  p_org_id             uuid,
  p_org_slug           text,
  p_include_zero_calls boolean default false,
  p_limit              int default 50,
  p_offset             int default 0,
  p_filters            jsonb default '[]'::jsonb,
  p_sort_by            jsonb default null,
  p_search             text default null,
  p_from               timestamptz default null,
  p_to                 timestamptz default null
)
returns table (
  id                          uuid,
  created_at                  timestamptz,
  updated_at                  timestamptz,
  organisation_id             uuid,
  org_slug                    text,
  name                        text,
  phone                       text,
  phone_normalized            text,
  first_seen_at               timestamptz,
  last_contact_at             timestamptz,
  current_intent              public.intent_type,
  current_intent_score        smallint,   -- NEW
  city                        text,
  pincode                     text,
  notes                       text,
  source                      public.lead_source,
  status                      public.lead_status,
  pending_action              boolean,
  owner_label                 text,       -- NEW
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
  v_where           text := '';
  v_sort_clause     text := 'ca.total_calls desc nulls last, ca.last_call_at desc nulls last, l.created_at desc';
  v_filter          jsonb;
  v_source          text;
  v_category        text;
  v_key             text;
  v_op              text;
  v_value           jsonb;
  v_jsonb_path      text;
  v_text_expr       text;
  v_sort_source     text;
  v_sort_key        text;
  v_sort_cat        text;
  v_sort_dir        text;
  v_sort_type       text;
  v_sql             text;
  v_search_trimmed  text;
  v_search_digits   text;
begin
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

      if v_source = 'lead_data' then
        v_jsonb_path := format('l.lead_data->%L', v_key);
      elsif v_source = 'custom_data' then
        if v_category is null or v_category = '' then
          v_jsonb_path := format('l.custom_data->%L', v_key);
        else
          v_jsonb_path := format('l.custom_data->%L->%L', v_category, v_key);
        end if;
      elsif v_source = 'column' then
        -- NEW: current_intent_score, owner_label
        if v_key in (
          'current_intent', 'current_intent_score', 'owner_label',
          'pending_action', 'status', 'city', 'pincode', 'name'
        ) then
          v_jsonb_path := format('l.%I', v_key);
        elsif v_key in (
          'inbound_calls', 'outbound_calls', 'total_calls',
          'last_call_at', 'first_call_at', 'total_duration_seconds'
        ) then
          v_jsonb_path := format('ca.%I', v_key);
        else
          continue;
        end if;
      else
        continue;
      end if;

      if v_source in ('lead_data', 'custom_data') then
        v_text_expr := v_jsonb_path || '#>>''{}''';
      else
        v_text_expr := v_jsonb_path || '::text';
      end if;

      if v_op = 'eq' then
        if v_source in ('lead_data', 'custom_data') then
          v_where := v_where || format(' and %s = %L::jsonb', v_jsonb_path, v_value::text);
        else
          v_where := v_where || format(' and %s::text = %L', v_jsonb_path, v_value#>>'{}');
        end if;
      elsif v_op = 'neq' then
        if v_source in ('lead_data', 'custom_data') then
          v_where := v_where || format(' and (%s is null or %s <> %L::jsonb)', v_jsonb_path, v_jsonb_path, v_value::text);
        else
          v_where := v_where || format(' and (%s is null or %s::text <> %L)', v_jsonb_path, v_jsonb_path, v_value#>>'{}');
        end if;
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
    v_search_trimmed := trim(p_search);
    v_search_digits  := regexp_replace(v_search_trimmed, '[^0-9]', '', 'g');
    if length(v_search_digits) >= 3 then
      v_where := v_where || format(
        ' and (l.search_tsv @@ plainto_tsquery(''simple'', %L) or l.phone_normalized ilike %L)',
        v_search_trimmed,
        '%' || v_search_digits || '%'
      );
    else
      v_where := v_where || format(
        ' and l.search_tsv @@ plainto_tsquery(''simple'', %L)',
        v_search_trimmed
      );
    end if;
  end if;

  if p_from is not null then
    v_where := v_where || format(' and l.created_at >= %L', p_from);
  end if;
  if p_to is not null then
    v_where := v_where || format(' and l.created_at < %L', p_to);
  end if;

  if p_sort_by is not null and jsonb_typeof(p_sort_by) = 'object' then
    v_sort_source := coalesce(p_sort_by->>'source', 'column');
    v_sort_key    := p_sort_by->>'key';
    v_sort_cat    := coalesce(p_sort_by->>'category', '');
    v_sort_dir    := case lower(coalesce(p_sort_by->>'dir', 'desc'))
                       when 'asc' then 'asc' else 'desc' end;
    v_sort_type   := lower(coalesce(p_sort_by->>'type', 'text'));

    if v_sort_key is not null then
      if v_sort_source = 'column' then
        -- NEW: current_intent_score, owner_label
        if v_sort_key in (
          'name', 'created_at', 'updated_at', 'last_contact_at',
          'first_seen_at', 'status', 'current_intent', 'current_intent_score',
          'owner_label', 'pending_action', 'city', 'pincode'
        ) then
          v_sort_clause := format('l.%I %s nulls last', v_sort_key, v_sort_dir);
        elsif v_sort_key in (
          'inbound_calls', 'outbound_calls', 'total_calls',
          'last_call_at', 'first_call_at', 'total_duration_seconds'
        ) then
          v_sort_clause := format('ca.%I %s nulls last', v_sort_key, v_sort_dir);
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
      l.current_intent, l.current_intent_score,
      l.city, l.pincode, l.notes,
      l.source, l.status, l.pending_action, l.owner_label,
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
  uuid, text, boolean, int, int, jsonb, jsonb, text, timestamptz, timestamptz
) to authenticated;

-- -----------------------------------------------------------------------------
-- Count function: same allowlist additions so a filter on either new column
-- narrows the "you'll download N rows" preview the same way it narrows the
-- table. A filter the list honours and the count ignores is how an export
-- promises one number and delivers another.
-- -----------------------------------------------------------------------------

create or replace function public.lead_call_activity_count(
  p_org_id             uuid,
  p_org_slug           text,
  p_include_zero_calls boolean default false,
  p_filters            jsonb default '[]'::jsonb,
  p_search             text default null,
  p_from               timestamptz default null,
  p_to                 timestamptz default null
)
returns bigint
language plpgsql
security invoker
stable
as $$
declare
  v_where           text := '';
  v_filter          jsonb;
  v_source          text;
  v_category        text;
  v_key             text;
  v_op              text;
  v_value           jsonb;
  v_jsonb_path      text;
  v_text_expr       text;
  v_sql             text;
  v_count           bigint;
  v_search_trimmed  text;
  v_search_digits   text;
begin
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

      if v_source = 'lead_data' then
        v_jsonb_path := format('l.lead_data->%L', v_key);
      elsif v_source = 'custom_data' then
        if v_category is null or v_category = '' then
          v_jsonb_path := format('l.custom_data->%L', v_key);
        else
          v_jsonb_path := format('l.custom_data->%L->%L', v_category, v_key);
        end if;
      elsif v_source = 'column' then
        -- NEW: current_intent_score, owner_label
        if v_key in (
          'current_intent', 'current_intent_score', 'owner_label',
          'pending_action', 'status', 'city', 'pincode', 'name'
        ) then
          v_jsonb_path := format('l.%I', v_key);
        elsif v_key in (
          'inbound_calls', 'outbound_calls', 'total_calls',
          'last_call_at', 'first_call_at', 'total_duration_seconds'
        ) then
          v_jsonb_path := format('ca.%I', v_key);
        else
          continue;
        end if;
      else
        continue;
      end if;

      if v_source in ('lead_data', 'custom_data') then
        v_text_expr := v_jsonb_path || '#>>''{}''';
      else
        v_text_expr := v_jsonb_path || '::text';
      end if;

      if v_op = 'eq' then
        if v_source in ('lead_data', 'custom_data') then
          v_where := v_where || format(' and %s = %L::jsonb', v_jsonb_path, v_value::text);
        else
          v_where := v_where || format(' and %s::text = %L', v_jsonb_path, v_value#>>'{}');
        end if;
      elsif v_op = 'neq' then
        if v_source in ('lead_data', 'custom_data') then
          v_where := v_where || format(' and (%s is null or %s <> %L::jsonb)', v_jsonb_path, v_jsonb_path, v_value::text);
        else
          v_where := v_where || format(' and (%s is null or %s::text <> %L)', v_jsonb_path, v_jsonb_path, v_value#>>'{}');
        end if;
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
    v_search_trimmed := trim(p_search);
    v_search_digits  := regexp_replace(v_search_trimmed, '[^0-9]', '', 'g');
    if length(v_search_digits) >= 3 then
      v_where := v_where || format(
        ' and (l.search_tsv @@ plainto_tsquery(''simple'', %L) or l.phone_normalized ilike %L)',
        v_search_trimmed,
        '%' || v_search_digits || '%'
      );
    else
      v_where := v_where || format(
        ' and l.search_tsv @@ plainto_tsquery(''simple'', %L)',
        v_search_trimmed
      );
    end if;
  end if;

  if p_from is not null then
    v_where := v_where || format(' and l.created_at >= %L', p_from);
  end if;
  if p_to is not null then
    v_where := v_where || format(' and l.created_at < %L', p_to);
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
    )
    select count(*)::bigint
    from public.leads l
    left join call_aggs ca on ca.lead_id = l.id
    where l.organisation_id = %L
      and (%L or coalesce(ca.total_calls, 0) > 0)
      %s
  $f$, p_org_id, p_org_id, p_include_zero_calls, v_where);

  execute v_sql into v_count;
  return v_count;
end;
$$;

grant execute on function public.lead_call_activity_count(
  uuid, text, boolean, jsonb, text, timestamptz, timestamptz
) to authenticated;

notify pgrst, 'reload schema';
