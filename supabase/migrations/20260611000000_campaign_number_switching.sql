-- =============================================================================
-- 20260611000000 — Connect-rate-based caller-ID switching (per campaign).
-- =============================================================================
-- Replaces the fixed daily call cap as the spam-avoidance driver. Instead of
-- "rest a number after N calls/day", the dispatcher now watches each number's
-- CONNECT RATE over a rolling window and rests a number whose rate falls below
-- a floor — the direct symptom of being spam-flagged. Both knobs are per
-- campaign (set at upload):
--
--   campaigns.switch_connect_rate_floor   percent (0..100). Rest a number whose
--                                          connect rate over the window is below
--                                          this (once it has enough samples).
--   campaigns.switch_window_minutes        rolling window the rate is measured
--                                          over (5..1440).
--   campaigns.switch_min_samples           dials in the window before the rate
--                                          is trusted (avoids noise on tiny n).
--
--   campaign_contacts.health_defer_count   how many times this contact has been
--                                          deferred because every caller-ID was
--                                          resting. After a few rounds the
--                                          dispatcher falls back to the
--                                          least-bad number so the run finishes.
--
-- bolna_integrations.daily_calls_per_number is left in place but is no longer
-- read by the dispatcher (dormant). Append-only: earlier migrations untouched.
-- =============================================================================

alter table public.campaigns
  add column if not exists switch_connect_rate_floor smallint not null default 30;
alter table public.campaigns
  add column if not exists switch_window_minutes integer not null default 60;
alter table public.campaigns
  add column if not exists switch_min_samples smallint not null default 20;

do $$
begin
  alter table public.campaigns
    drop constraint if exists campaigns_switch_floor_range;
  alter table public.campaigns
    add constraint campaigns_switch_floor_range
    check (switch_connect_rate_floor between 0 and 100);

  alter table public.campaigns
    drop constraint if exists campaigns_switch_window_range;
  alter table public.campaigns
    add constraint campaigns_switch_window_range
    check (switch_window_minutes between 5 and 1440);

  alter table public.campaigns
    drop constraint if exists campaigns_switch_min_samples_range;
  alter table public.campaigns
    add constraint campaigns_switch_min_samples_range
    check (switch_min_samples between 1 and 1000);
end $$;

alter table public.campaign_contacts
  add column if not exists health_defer_count smallint not null default 0;

do $$
begin
  alter table public.campaign_contacts
    drop constraint if exists campaign_contacts_health_defer_nonneg;
  alter table public.campaign_contacts
    add constraint campaign_contacts_health_defer_nonneg
    check (health_defer_count >= 0);
end $$;

comment on column public.campaigns.switch_connect_rate_floor is
  'Connect-rate floor (percent) for caller-ID switching. A number whose connect rate over switch_window_minutes drops below this (with >= switch_min_samples dials) is rested. Replaces the fixed daily cap.';
comment on column public.campaigns.switch_window_minutes is
  'Rolling window (minutes) over which a caller-ID''s connect rate is measured for switching.';
comment on column public.campaigns.switch_min_samples is
  'Minimum dials a caller-ID must have in the window before its connect rate is trusted (below this it is treated as healthy).';
comment on column public.campaign_contacts.health_defer_count is
  'Consecutive times this contact was deferred because every caller-ID was resting. After a few rounds the dispatcher dials from the least-bad number instead of deferring further.';
