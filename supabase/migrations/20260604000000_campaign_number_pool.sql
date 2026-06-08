-- =============================================================================
-- 20260604000000 — Campaign caller-ID pool (number rotation).
-- =============================================================================
-- A campaign can now dial from a SET of caller-ID numbers instead of one. The
-- dispatcher round-robins across them under a per-number daily cap so a single
-- number isn't burned through and flagged as spam by carriers.
--
--   campaigns.from_phone_numbers text[]  NEW — the allowed caller-ID pool for
--                                              this campaign. Empty/NULL means
--                                              "fall back to the single
--                                              from_phone_number, then the org
--                                              default" (back-compat).
--
-- The legacy single `from_phone_number` column stays for back-compat and as the
-- override when exactly one number is chosen. Selection precedence at dispatch:
--   campaign.from_phone_numbers[] (rotated) → campaign.from_phone_number
--   → org default from bolna_integrations.
-- =============================================================================

alter table public.campaigns
  add column if not exists from_phone_numbers text[] not null default '{}'::text[];

-- Guard against blank entries sneaking into the array (mirrors the same
-- constraint on bolna_integrations.from_phone_numbers).
do $$
begin
  alter table public.campaigns
    drop constraint if exists campaigns_from_phone_numbers_nonblank;
  alter table public.campaigns
    add constraint campaigns_from_phone_numbers_nonblank
    check (not (array['' ::text] && from_phone_numbers));
end $$;

comment on column public.campaigns.from_phone_numbers is
  'Allowed caller-ID pool for this campaign. The dispatcher rotates across these under a per-number daily cap. Empty → fall back to from_phone_number, then the org default.';

-- ---------------------------------------------------------------------------
-- Per-number daily dial count — powers both the rotation cap and the
-- dashboard per-number stats. We derive it on demand from `calls` rather than
-- maintaining a counter table: campaign call volume is bounded and an index on
-- (from_phone, started_at) keeps the GROUP BY cheap.
-- ---------------------------------------------------------------------------
create index if not exists calls_from_phone_started_idx
  on public.calls (from_phone, started_at desc)
  where from_phone is not null;
