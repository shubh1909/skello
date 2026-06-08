-- =============================================================================
-- 20260608000000 — Disposition-based campaign retry (call_outcome).
-- =============================================================================
-- Campaign retry today is purely TECHNICAL: campaigns.retry_on only re-dials on
-- connection failures (no_answer / busy / failed / canceled), and a `completed`
-- call is always marked succeeded — regardless of what the customer actually
-- said. This adds a second, SEMANTIC axis: the voice agent extracts a single
-- `call_outcome` disposition (interested / not_interested / callback_requested /
-- do_not_call / wrong_number / no_decision) plus an optional `callback_at`, and
-- the campaign state machine branches on it.
--
-- New columns:
--   calls.call_outcome            text  — canonical disposition for this call.
--   calls.requested_callback_at   tstz  — when the customer asked to be re-called.
--   campaign_contacts.callback_count int — honored callbacks so far (a SEPARATE
--                                          budget from technical retry attempts).
--   campaigns.max_callbacks       int   — cap on honored callbacks (default 2).
--
-- Budget model: a contact may be dialed while
--   attempt < max_attempts + callback_count
-- i.e. each honored "call me later" grants one extra dial ON TOP of the
-- technical retry cap, so a genuine callback is never starved by no-answers.
--
-- DNC scope is intentionally PER-CAMPAIGN (a do_not_call ends this contact; it
-- does not flag the lead globally). Revisit if compliance needs cross-campaign
-- suppression — that would be a leads-level column + a dispatch-time filter.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- calls: the per-conversation disposition snapshot.
-- -----------------------------------------------------------------------------
alter table public.calls
  add column if not exists call_outcome text;

alter table public.calls
  add column if not exists requested_callback_at timestamptz;

do $$
begin
  alter table public.calls
    drop constraint if exists calls_call_outcome_vocab;
  alter table public.calls
    add constraint calls_call_outcome_vocab
    check (
      call_outcome is null
      or call_outcome in (
        'interested',
        'meeting_booked',
        'not_interested',
        'callback_requested',
        'do_not_call',
        'wrong_number',
        'no_decision'
      )
    );
end $$;

-- Dashboard / filter support: outcome breakdowns are org-scoped reads.
create index if not exists calls_call_outcome_idx
  on public.calls (organisation_id, call_outcome)
  where call_outcome is not null;

comment on column public.calls.call_outcome is
  'Canonical customer disposition extracted from the conversation (interested / meeting_booked / not_interested / callback_requested / do_not_call / wrong_number / no_decision). Drives disposition-based campaign retry; NULL for inbound or un-extracted calls.';
comment on column public.calls.requested_callback_at is
  'When the customer asked to be called back. Only meaningful when call_outcome = callback_requested; used as next_attempt_at for the re-armed contact.';

-- -----------------------------------------------------------------------------
-- campaign_contacts: separate callback budget counter.
-- -----------------------------------------------------------------------------
alter table public.campaign_contacts
  add column if not exists callback_count smallint not null default 0;

-- Last semantic disposition seen for this contact (mirrors calls.call_outcome
-- on the most recent completed call) so the campaign UI can show it without
-- joining to calls. last_status keeps holding the TECHNICAL status.
alter table public.campaign_contacts
  add column if not exists last_outcome text;

do $$
begin
  alter table public.campaign_contacts
    drop constraint if exists campaign_contacts_callback_count_nonneg;
  alter table public.campaign_contacts
    add constraint campaign_contacts_callback_count_nonneg
    check (callback_count >= 0);
end $$;

comment on column public.campaign_contacts.callback_count is
  'Number of customer-requested callbacks honored for this contact. A SEPARATE budget from `attempt` (technical retries): the dispatch gate allows dialing while attempt < max_attempts + callback_count, so an honored "call me later" grants one extra dial.';
comment on column public.campaign_contacts.last_outcome is
  'Most recent semantic call_outcome for this contact (interested / callback_requested / do_not_call / ...). Display convenience; last_status holds the technical status.';

-- -----------------------------------------------------------------------------
-- campaigns: the callback budget cap.
-- -----------------------------------------------------------------------------
alter table public.campaigns
  add column if not exists max_callbacks smallint not null default 2;

do $$
begin
  alter table public.campaigns
    drop constraint if exists campaigns_max_callbacks_range;
  alter table public.campaigns
    add constraint campaigns_max_callbacks_range
    check (max_callbacks between 0 and 5);
end $$;

comment on column public.campaigns.max_callbacks is
  'Max customer-requested callbacks ("call me next week") that may be honored per contact, independent of max_attempts. 0 disables callback honoring; default 2.';
