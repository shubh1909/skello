-- Call direction + transcript storage.
--
-- Design notes:
--
-- - `direction` distinguishes inbound (captured from a caller) from outbound
--   (we placed the call). Every row before this migration was outbound
--   (initiateCall is the only path that inserted); we backfill accordingly.
--
-- - `transcript` TEXT is the raw blob from the voice provider's execution API.
--   It is the source of truth. If our parser ever breaks, the raw string is
--   still searchable with `to_tsvector(transcript)`.
--
-- - `call_transcripts` is a child table with one row per utterance. The
--   structured form is parsed from the blob. It powers timeline UI,
--   per-speaker talk-time metrics, and per-turn full-text search. Deleting
--   a call cascades to its turns.
--
-- - `transcript_status` tracks the ingestion lifecycle:
--     pending    → freshly inserted, not yet fetched
--     processing → fetch in flight
--     ready      → raw + parsed turns stored
--     failed     → fetch attempted and failed (retry later)
--     skipped    → call won't have a transcript (e.g. failed/no_answer)
--
-- - `to_phone` becomes nullable: inbound calls from restricted-CLI numbers
--   are a real case and we still want the row.

-- ---------------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------------

create type if not exists public.call_direction as enum ('inbound', 'outbound');

create type if not exists public.call_transcript_status as enum (
  'pending',
  'processing',
  'ready',
  'failed',
  'skipped'
);

create type if not exists public.call_turn_speaker as enum (
  'agent',
  'user',
  'system'
);

-- ---------------------------------------------------------------------------
-- Extend calls
-- ---------------------------------------------------------------------------

alter table public.calls
  add column if not exists direction             public.call_direction not null default 'outbound',
  add column if not exists transcript            text,
  add column if not exists transcript_status     public.call_transcript_status not null default 'pending',
  add column if not exists transcript_fetched_at timestamptz,
  add column if not exists language              text;

alter table public.calls
  alter column to_phone drop not null;

-- Every existing row came from initiateCall (we were the caller).
update public.calls set direction = 'outbound' where direction is null;

create index if not exists calls_lead_direction_idx
  on public.calls (lead_id, direction, started_at desc);

-- ---------------------------------------------------------------------------
-- call_transcripts
-- ---------------------------------------------------------------------------

create table if not exists public.call_transcripts (
  id              uuid primary key default gen_random_uuid(),
  call_id         uuid not null references public.calls(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  seq             integer not null check (seq >= 0),
  speaker         public.call_turn_speaker not null,
  text            text not null,
  started_ms      integer check (started_ms is null or started_ms >= 0),
  ended_ms        integer check (ended_ms is null or ended_ms >= 0),
  confidence      numeric(4, 3)
                  check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at      timestamptz not null default now(),
  unique (call_id, seq)
);

create index if not exists call_transcripts_call_idx
  on public.call_transcripts (call_id, seq);
create index if not exists call_transcripts_org_idx
  on public.call_transcripts (organisation_id);

-- FTS — 'simple' tokenises without stemming, safe for mixed Hindi/English.
create index if not exists call_transcripts_text_fts_idx
  on public.call_transcripts using gin (to_tsvector('simple', text));

-- ---------------------------------------------------------------------------
-- RLS — mirror the pattern on public.calls.
-- ---------------------------------------------------------------------------

alter table public.call_transcripts enable row level security;

drop policy if exists "call_transcripts_select_own_org" on public.call_transcripts;
create policy "call_transcripts_select_own_org"
  on public.call_transcripts for select
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "call_transcripts_insert_own_org" on public.call_transcripts;
create policy "call_transcripts_insert_own_org"
  on public.call_transcripts for insert
  to authenticated
  with check (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );

drop policy if exists "call_transcripts_delete_own_org" on public.call_transcripts;
create policy "call_transcripts_delete_own_org"
  on public.call_transcripts for delete
  to authenticated
  using (
    organisation_id in (
      select id from public.organisations where owner_id = (select auth.uid())
    )
  );
