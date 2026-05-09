-- lead_call_activity_count: scalar count companion to lead_call_activity.
-- Returns the number of distinct normalized phones in `leads` for the org.
-- When p_include_zero_calls = false (the page default), restricts to phones
-- that also appear as a counterparty on at least one call. Used by the
-- sidebar badge so the "Leads" tab shows the same count the page displays.

create or replace function public.lead_call_activity_count(
  p_org_id             uuid,
  p_org_slug           text,
  p_include_zero_calls boolean default false
)
returns bigint
language sql
security invoker
stable
as $$
  with call_phones as (
    select distinct
      regexp_replace(
        coalesce(
          case when direction = 'inbound' then from_phone else to_phone end,
          ''
        ),
        '[^0-9]', '', 'g'
      ) as phone_norm
    from public.calls
    where organisation_id = p_org_id
  ),
  lead_phones as (
    select distinct
      regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g') as phone_norm
    from public.leads l
    where l.org_slug = p_org_slug
      and l.phone is not null
      and l.phone <> ''
  )
  select count(*)::bigint
  from lead_phones lp
  where lp.phone_norm <> ''
    and (
      p_include_zero_calls
      or lp.phone_norm in (
        select phone_norm from call_phones where phone_norm <> ''
      )
    );
$$;

grant execute on function public.lead_call_activity_count(uuid, text, boolean)
  to authenticated;
