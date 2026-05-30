-- =============================================================================
-- 20260528000001 — Postgres-backed rate limiter.
-- =============================================================================
-- Self-contained rate limiter for sensitive surfaces (login, signup,
-- outbound call init, exports, webhooks). Backing in Supabase Postgres
-- instead of a third-party store (Upstash/Redis) keeps infra small and
-- the audit trail co-located with the rest of the app.
--
-- Pattern: fixed-window counter keyed on caller-supplied bucket id (e.g.
-- "login:ip:1.2.3.4" or "test-call:org:<uuid>"). Each `check_rate_limit`
-- call atomically increments and reports whether the call is still
-- inside the budget for the current window. When the window expires the
-- count resets on the next call.
--
-- The single-row upsert + RETURNING avoids the classic race that hits
-- naive SELECT-then-UPDATE rate limiters under burst load.
-- =============================================================================

create table if not exists public.rate_limits (
  -- Bucket identifier supplied by the caller. Examples:
  --   "login:ip:203.0.113.7"
  --   "signup:ip:203.0.113.7"
  --   "test-call:org:00000000-0000-0000-0000-000000000000"
  --   "leads-export:user:11111111-1111-1111-1111-111111111111"
  --   "bolna-webhook:ip:198.51.100.4"
  key            text        primary key,
  window_start   timestamptz not null default now(),
  count          integer     not null default 0,
  updated_at     timestamptz not null default now()
);

comment on table public.rate_limits is
  'Fixed-window rate-limit counters. Written via check_rate_limit() only — ' ||
  'application code never reads or writes this table directly.';

-- Sweep old rows opportunistically. Not a critical job (the upsert in
-- check_rate_limit overwrites stale rows) but keeps the table small
-- enough that the PK btree stays in shared_buffers.
create index if not exists rate_limits_updated_at_idx
  on public.rate_limits (updated_at);

-- -----------------------------------------------------------------------------
-- check_rate_limit(key, window_seconds, max_calls)
-- -----------------------------------------------------------------------------
-- Atomically increments the counter for `p_key` within a rolling
-- window of `p_window_seconds`. Returns:
--   * allowed              — true while count <= p_max, false once exceeded
--   * retry_after_seconds  — seconds until the current window expires
--                            (always >=0; 0 when allowed)
--
-- security definer so the helper can be called from `authenticated` and
-- `service_role` paths uniformly without each caller needing INSERT/
-- UPDATE on rate_limits. The function itself owns the access path.
-- -----------------------------------------------------------------------------

create or replace function public.check_rate_limit(
  p_key             text,
  p_window_seconds  integer,
  p_max             integer
)
returns table (
  allowed              boolean,
  retry_after_seconds  integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now            timestamptz := now();
  v_window_cutoff  timestamptz := v_now - make_interval(secs => p_window_seconds);
  v_count          integer;
  v_window_start   timestamptz;
begin
  -- Defensive bounds. Negative / zero windows would either divide by
  -- zero or open the gate; an absurd window pin'd to 1 day prevents
  -- key explosion in the table from a buggy caller.
  if p_window_seconds <= 0 then p_window_seconds := 60; end if;
  if p_window_seconds > 86400 then p_window_seconds := 86400; end if;
  if p_max <= 0 then p_max := 1; end if;

  -- Single-statement upsert. The CASE branches handle two scenarios in
  -- one atomic step:
  --   * window expired (window_start older than cutoff) → reset to 1
  --   * window active                                   → increment
  insert into public.rate_limits (key, window_start, count, updated_at)
  values (p_key, v_now, 1, v_now)
  on conflict (key) do update
    set
      count = case
        when public.rate_limits.window_start < v_window_cutoff then 1
        else public.rate_limits.count + 1
      end,
      window_start = case
        when public.rate_limits.window_start < v_window_cutoff then v_now
        else public.rate_limits.window_start
      end,
      updated_at = v_now
  returning public.rate_limits.count, public.rate_limits.window_start
    into v_count, v_window_start;

  if v_count > p_max then
    return query select
      false,
      greatest(
        0,
        extract(epoch from (v_window_start + make_interval(secs => p_window_seconds) - v_now))::integer
      );
  else
    return query select true, 0;
  end if;
end;
$$;

comment on function public.check_rate_limit(text, integer, integer) is
  'Fixed-window rate limiter. Increments counter for key within window; ' ||
  'returns (allowed, retry_after_seconds). Call from server-only paths.';

-- Service role is the only legitimate caller — the helper in
-- src/lib/rate-limit.ts always uses the admin client so the rate
-- check itself can't be skipped by an unauthenticated user. anon
-- and authenticated remain locked out.
revoke execute on function public.check_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer)
  to service_role;

-- RLS on rate_limits: no policy needed — the table is service-role
-- only and read access would itself be a side-channel ("does X have
-- hit the rate limit today?"). Locking the table down keeps that
-- side-channel closed even if a future migration adds the table to
-- the API schema by accident.
alter table public.rate_limits enable row level security;
