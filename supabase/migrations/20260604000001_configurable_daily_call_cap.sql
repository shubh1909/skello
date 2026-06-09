-- =============================================================================
-- 20260604000001 — Per-org configurable daily-calls-per-number cap.
-- =============================================================================
-- The number-rotation cap (how many dials a single caller-ID may place in a
-- rolling 24h window before the dispatcher rests it) was a hardcoded 200. That
-- doesn't fit every org: numbers with full STIR/SHAKEN registration tolerate
-- far more, fresh/unregistered numbers far less. Make it a per-org setting that
-- a platform admin tunes on the voice-agent admin page.
--
--   bolna_integrations.daily_calls_per_number int  NEW — default 200.
--                                                        Range 1..10000.
--
-- Read at dispatch time (lib/campaigns/dispatch.ts) and surfaced on the
-- campaign create warning + dashboard per-number stats so the operator sees the
-- same ceiling everywhere.
-- =============================================================================

alter table public.bolna_integrations
  add column if not exists daily_calls_per_number integer not null default 200;

do $$
begin
  alter table public.bolna_integrations
    drop constraint if exists bolna_integrations_daily_cap_range;
  alter table public.bolna_integrations
    add constraint bolna_integrations_daily_cap_range
    check (daily_calls_per_number between 1 and 10000);
end $$;

comment on column public.bolna_integrations.daily_calls_per_number is
  'Max outbound dials per caller-ID number in a rolling 24h window before the campaign dispatcher rests it (spam avoidance). Default 200; admin-tunable per org.';
