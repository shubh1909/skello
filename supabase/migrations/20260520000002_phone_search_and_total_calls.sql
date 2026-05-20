-- 1. Phone-substring search. `to_tsvector('simple', '+918240501061')`
--    produces a single token `918240501061`, and `plainto_tsquery` only
--    matches whole lexemes — so typing "8240" matched nothing because
--    "8240" isn't a separate token in that string. Fix: when the search
--    input contains 3+ digits, OR an `ILIKE '%<digits>%'` against
--    phone_normalized into the WHERE clause. Tsvector path stays the
--    primary search for non-numeric input.
-- 2. Add `total_calls` to the first-class column catalog (alongside the
--    six seeded in 20260520000001). Updates the trigger function so new
--    orgs get it too.

-- -----------------------------------------------------------------------------
-- (1) Seed `total_calls` for existing orgs.
-- -----------------------------------------------------------------------------

insert into public.lead_field_definitions (
  organisation_id, source_column, category, key_path, label,
  data_type, visible_in_table, filterable, sortable, searchable, display_order
)
select
  o.id, 'column'::public.lead_field_source, '', 'total_calls', 'Total',
  'number'::public.lead_field_data_type,
  true, false, true, false, 115
from public.organisations o
on conflict (organisation_id, source_column, category, key_path) do nothing;

-- Refresh the trigger function to include total_calls for new orgs.
create or replace function public.seed_org_first_class_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.lead_field_definitions (
    organisation_id, source_column, category, key_path, label,
    data_type, visible_in_table, filterable, sortable, searchable, display_order
  )
  values
    (new.id, 'column', '', 'inbound_calls',  'In',            'number',  true, false, true,  false, 100),
    (new.id, 'column', '', 'outbound_calls', 'Out',           'number',  true, false, true,  false, 110),
    (new.id, 'column', '', 'total_calls',    'Total',         'number',  true, false, true,  false, 115),
    (new.id, 'column', '', 'last_call_at',   'Last contact',  'date',    true, false, true,  false, 120),
    (new.id, 'column', '', 'first_call_at',  'First contact', 'date',    true, false, true,  false, 130),
    (new.id, 'column', '', 'current_intent', 'Intent',        'enum',    true, true,  true,  false, 140),
    (new.id, 'column', '', 'pending_action', 'Pending',       'boolean', true, true,  false, false, 150)
  on conflict (organisation_id, source_column, category, key_path) do nothing;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- (2) Replace the lead_call_activity RPC with a phone-aware search clause.
--     Only the search block changes — sort/filter/return signature is the
--     same as 20260520000001.
-- -----------------------------------------------------------------------------

create or replace function public.lead_call_activity(
  p_org_id             uuid,
  p_org_slug           text,
  p_include_zero_calls boolean default false,
  p_limit              int default 50,
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
  phone                       text,
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
        if v_key in (
          'current_intent', 'pending_action', 'status', 'city', 'pincode', 'name'
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

  -- Search: tsvector for free text, ILIKE on phone_normalized for digit
  -- runs. Combined with OR so "Ali" hits the name index *and* "8240" hits
  -- phone numbers without forcing the user to pick one. Min 3 digits to
  -- avoid sweeping 1-char/2-char queries that would match every row.
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

  if p_sort_by is not null and jsonb_typeof(p_sort_by) = 'object' then
    v_sort_source := coalesce(p_sort_by->>'source', 'column');
    v_sort_key    := p_sort_by->>'key';
    v_sort_cat    := coalesce(p_sort_by->>'category', '');
    v_sort_dir    := case lower(coalesce(p_sort_by->>'dir', 'desc'))
                       when 'asc' then 'asc' else 'desc' end;
    v_sort_type   := lower(coalesce(p_sort_by->>'type', 'text'));

    if v_sort_key is not null then
      if v_sort_source = 'column' then
        if v_sort_key in (
          'name', 'created_at', 'updated_at', 'last_contact_at',
          'first_seen_at', 'status', 'current_intent', 'pending_action',
          'city', 'pincode'
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

-- -----------------------------------------------------------------------------
-- (3) Mirror the phone-search change on the count RPC.
-- -----------------------------------------------------------------------------

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
        if v_key in (
          'current_intent', 'pending_action', 'status', 'city', 'pincode', 'name'
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

grant execute on function public.lead_call_activity_count(uuid, text, boolean, jsonb, text)
  to authenticated;
