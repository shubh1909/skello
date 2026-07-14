-- =============================================================================
-- 20260714000000 — Per-lead connected-call cap (global per-org governor).
-- =============================================================================
-- A lead (identified by phone — leads are phone-deduped) must not be
-- SUCCESSFULLY CONNECTED to more than N times inside a rolling 48h window,
-- across every outbound calling surface (cart recovery, campaigns, scheduled
-- callbacks). N is per-org, default 2.
--
--   bolna_integrations.max_connected_calls_per_lead smallint  NEW.
--       DEFAULT 2. NULL → unlimited (opt-out). Range 1..1000.
--
-- Read at dispatch time by every outbound dispatcher (lib/shopify/recovery.ts,
-- lib/campaigns/dispatch.ts, lib/callbacks/dispatch.ts) via
-- lib/calls/connect-cap.ts. The cap keys on the dialled phone, NOT lead_id,
-- because campaign call rows carry no lead_id — phone is the only reliable
-- cross-surface identity for "the same lead".
-- =============================================================================

alter table public.bolna_integrations
  add column if not exists max_connected_calls_per_lead smallint default 2;

do $$
begin
  alter table public.bolna_integrations
    drop constraint if exists bolna_integrations_max_connected_per_lead_range;
  alter table public.bolna_integrations
    add constraint bolna_integrations_max_connected_per_lead_range
    check (
      max_connected_calls_per_lead is null
      or max_connected_calls_per_lead between 1 and 1000
    );
end $$;

comment on column public.bolna_integrations.max_connected_calls_per_lead is
  'Max successful connections to one lead (dialled phone) across all outbound '
  'surfaces in a rolling 48h window before dispatchers stop dialling that lead. '
  'Default 2; NULL = unlimited. Admin-tunable per org.';

-- Supports the per-phone connect count in lib/calls/connect-cap.ts: filter by
-- org + phone over recent connected outbound dials. "Connected" = the shopper
-- picked up (in_progress = answered/talking, completed = answered/hung up).
create index if not exists calls_org_to_phone_connected_idx
  on public.calls (organisation_id, to_phone, started_at desc)
  where direction = 'outbound' and status in ('in_progress', 'completed');
