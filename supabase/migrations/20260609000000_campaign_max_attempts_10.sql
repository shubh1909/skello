-- =============================================================================
-- 20260609000000 — Raise the campaign attempt ceiling 6 → 10.
-- =============================================================================
-- campaigns.max_attempts was capped at 6 (1 initial dial + up to 5 retries) by
-- an inline column CHECK in 20260508000000_campaigns.sql. Operators want more
-- retry headroom, so lift the ceiling to 10 (1 initial + up to 9 retries). The
-- Zod schema (lib/validations/campaign.ts) and the upload slider now allow the
-- same range.
--
-- The original inline check is auto-named campaigns_max_attempts_check; drop it
-- and replace with an explicitly-named range constraint so future tweaks have a
-- stable handle. Append-only: the 20260508000000 file is left untouched.
-- =============================================================================

do $$
begin
  alter table public.campaigns
    drop constraint if exists campaigns_max_attempts_check;
  alter table public.campaigns
    drop constraint if exists campaigns_max_attempts_range;
  alter table public.campaigns
    add constraint campaigns_max_attempts_range
    check (max_attempts between 1 and 10);
end $$;

comment on column public.campaigns.max_attempts is
  'Total dial attempts per contact (1 initial + retries). Range 1..10. Technical-retry budget; honored callbacks add headroom on top via campaign_contacts.callback_count.';
