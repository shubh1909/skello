-- =============================================================================
-- 20260623000000 — Per-campaign calling window (time-of-day + weekday guard).
-- =============================================================================
-- Restricts WHEN a campaign may place outbound dials. Outside the window the
-- dispatcher defers each due contact to the next window-open instant instead of
-- dialing (no attempt is consumed). Common use: "only call 09:00–18:00, Mon–Fri,
-- in the customer's timezone" — both a courtesy and a compliance guardrail.
--
--   campaigns.calling_window_start_minute   minutes since local midnight the
--                                            window opens (0..1439). NULL → no
--                                            window (dial any time).
--   campaigns.calling_window_end_minute     minutes since local midnight the
--                                            window closes (1..1440, exclusive).
--                                            Must be > start.
--   campaigns.calling_window_days           allowed weekdays, 0=Sun..6=Sat.
--                                            Empty array '{}' → every day.
--   campaigns.calling_window_timezone       IANA tz the minutes are interpreted
--                                            in (e.g. 'Asia/Kolkata'). Required
--                                            whenever a window is set.
--
-- A campaign has a window iff start, end, AND timezone are all non-null. The
-- check constraint keeps the three in lock-step. Append-only: earlier migrations
-- untouched, all columns nullable/defaulted so existing rows mean "no window".
-- =============================================================================

alter table public.campaigns
  add column if not exists calling_window_start_minute smallint;
alter table public.campaigns
  add column if not exists calling_window_end_minute smallint;
alter table public.campaigns
  add column if not exists calling_window_days smallint[] not null default '{}';
alter table public.campaigns
  add column if not exists calling_window_timezone text;

do $$
begin
  -- Bounds: start in [0,1439], end in [1,1440], end strictly after start.
  alter table public.campaigns
    drop constraint if exists campaigns_calling_window_bounds;
  alter table public.campaigns
    add constraint campaigns_calling_window_bounds
    check (
      calling_window_start_minute is null
      or (
        calling_window_start_minute between 0 and 1439
        and calling_window_end_minute between 1 and 1440
        and calling_window_end_minute > calling_window_start_minute
      )
    );

  -- All-or-nothing: start, end, and timezone are set together or not at all.
  alter table public.campaigns
    drop constraint if exists campaigns_calling_window_complete;
  alter table public.campaigns
    add constraint campaigns_calling_window_complete
    check (
      (
        calling_window_start_minute is null
        and calling_window_end_minute is null
        and calling_window_timezone is null
      )
      or (
        calling_window_start_minute is not null
        and calling_window_end_minute is not null
        and calling_window_timezone is not null
      )
    );

  -- Every weekday entry must be a valid 0..6 index.
  alter table public.campaigns
    drop constraint if exists campaigns_calling_window_days_valid;
  alter table public.campaigns
    add constraint campaigns_calling_window_days_valid
    check (calling_window_days <@ array[0,1,2,3,4,5,6]::smallint[]);
end $$;

comment on column public.campaigns.calling_window_start_minute is
  'Minutes since local midnight the calling window opens (0..1439), interpreted in calling_window_timezone. NULL means no window (dial any time).';
comment on column public.campaigns.calling_window_end_minute is
  'Minutes since local midnight the calling window closes (1..1440, exclusive). Must be greater than calling_window_start_minute.';
comment on column public.campaigns.calling_window_days is
  'Allowed weekdays for dialing, 0=Sunday..6=Saturday. Empty array means every day.';
comment on column public.campaigns.calling_window_timezone is
  'IANA timezone the calling-window minutes are interpreted in (e.g. Asia/Kolkata). Required whenever a window is set.';
