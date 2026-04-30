-- Leads: capture two fields surfaced by the inbound voice webhook.
--
-- 1. `actionable`: free-form string the agent extracts describing the
--    concrete next step from the conversation (e.g. "Send quote on Royal
--    Enfield Intercepter 2023", "Schedule visit Friday afternoon"). Nullable
--    so manually-created leads can leave it blank until reviewed.
--
-- 2. `recording_url`: link to the call recording on the provider's storage.
--    Stored on the lead (in addition to the calls table) so the operator can
--    reach the audio directly from the lead detail without joining. Each
--    subsequent inbound call from the same number overwrites this with the
--    latest recording.

alter table public.leads
  add column if not exists actionable text
    check (actionable is null or char_length(actionable) between 1 and 1000),
  add column if not exists recording_url text
    check (recording_url is null or char_length(recording_url) between 1 and 2000);
