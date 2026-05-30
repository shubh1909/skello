-- =============================================================================
-- 20260530000001 — Constrained read-only SQL widgets.
-- =============================================================================
-- The visual builder covers the common cases via an allowlist. For the long
-- tail, a platform admin can author a widget from a raw SELECT. To keep this
-- inside the project's security model we DO NOT run admin SQL freely:
--
--   * security invoker  — the query runs as the caller. On the org owner's
--                         dashboard render path that means RLS on the source
--                         tables scopes every row to their own org (Law #1).
--                         (The admin preview path runs as service_role and is
--                         intentionally unscoped — admins already see all orgs.)
--   * single statement  — a trailing ';' is stripped; any remaining ';'
--                         (stacked / multi-statement payloads) is rejected.
--   * SELECT-only       — must start with SELECT or WITH, and may not contain
--                         any write / DDL / session-control keyword anywhere
--                         (covers writable CTEs like `with x as (insert …)`).
--   * statement timeout — capped per call so a runaway query can't wedge a
--                         render.
--   * hard row cap      — the query is wrapped in a LIMIT.
--   * fixed shape       — the SELECT must return exactly three columns, in
--                         order: a text label (dim_a), a text group/NULL
--                         (dim_b), and a numeric value. Same contract the
--                         chart renderers already consume.
--
-- The app layer (sqlSelectOnlyError in lib/validations/dashboard-widget.ts)
-- enforces the same rules before storing — this SQL is the real boundary.
-- =============================================================================

create or replace function public.execute_dashboard_sql(
  p_org_id uuid,
  p_sql    text
)
returns table (
  dim_a text,
  dim_b text,
  value numeric
)
language plpgsql
security invoker
stable
as $$
declare
  v_q   text := btrim(coalesce(p_sql, ''));
  v_low text;
  v_sql text;
begin
  -- p_org_id is part of the contract for symmetry with
  -- execute_dashboard_widget; multi-tenancy is enforced by RLS under
  -- security invoker rather than by interpolating the id into the query.
  perform p_org_id;

  -- Strip one trailing ';', then forbid any remaining statement separator.
  v_q := regexp_replace(v_q, ';\s*$', '');
  if v_q = '' then
    raise exception 'SQL is required.' using errcode = '22023';
  end if;
  if position(';' in v_q) > 0 then
    raise exception 'Only a single statement is allowed.'
      using errcode = '22023';
  end if;

  v_low := lower(v_q);

  if v_low !~ '^(select|with)\M' then
    raise exception 'Query must start with SELECT or WITH.'
      using errcode = '22023';
  end if;

  -- Reject write / DDL / session-control keywords anywhere in the text,
  -- including inside a CTE body.
  if v_low ~ ('\m(insert|update|delete|drop|alter|truncate|create|grant|'
            || 'revoke|comment|copy|vacuum|analyze|reindex|refresh|call|do|'
            || 'merge|lock|listen|notify|prepare|deallocate|discard|set|'
            || 'reset|begin|commit|rollback|savepoint|into|attach|detach)\M')
  then
    raise exception 'Only read-only SELECT is allowed.'
      using errcode = '22023';
  end if;

  -- Cap runtime for this statement only (local to the current transaction).
  perform set_config('statement_timeout', '5000', true);

  -- Wrap: the column alias list forces exactly three output columns (a
  -- clear error otherwise) and the casts coerce them to the fixed shape;
  -- the LIMIT is a hard backstop even if the author forgot one.
  v_sql := format(
    'select (t.c1)::text, (t.c2)::text, (t.c3)::numeric '
    || 'from ( %s ) as t (c1, c2, c3) limit 5000',
    v_q
  );

  return query execute v_sql;
end;
$$;

comment on function public.execute_dashboard_sql(uuid, text) is
  'Runs a constrained read-only SELECT for a SQL dashboard widget. SELECT-only, single-statement, statement-timeout + row cap, security invoker so RLS scopes the result. Returns (dim_a text, dim_b text, value numeric).';

grant execute on function public.execute_dashboard_sql(uuid, text)
  to authenticated, service_role;
