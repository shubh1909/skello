-- =============================================================================
-- Intent score — the 0-100 figure the lead sheet leads with.
--
-- WHY A SECOND FIELD ALONGSIDE current_intent
--
-- `current_intent` is a three-value band (hot/warm/cold). A band cannot rank
-- two hot leads against each other, which is the actual question a sales floor
-- asks every morning. The score is the ranking key; the band stays because it
-- is what filters, badges and the dashboard's intent mix are built on.
--
-- SAME LIFECYCLE AS current_intent, deliberately. The score is emitted by the
-- voice agent's extraction as `intent_score` under lead_data, lands immutably
-- on the call row, and is rolled up to the lead by lib/bolna/lead-merge.ts
-- subject to the same lead_field_overrides lock. One provenance story for both
-- fields rather than two.
--
-- ⚠️ NOTHING POPULATES THIS UNTIL THE AGENTS ARE RECONFIGURED. As of the
-- 2026-08-12 audit, four of the seven live orgs emit no `lead_intent` either —
-- their extraction prompts simply have no such variable. The column, the
-- roll-up and the UI all handle null as "not scored" rather than as zero,
-- because a lead nobody has classified is not a lead scoring zero.
-- =============================================================================

alter table public.calls
  add column if not exists intent_score_extracted smallint;

alter table public.leads
  add column if not exists current_intent_score smallint;

-- Range enforced at the boundary as well (Zod, in the extraction coercion), but
-- a DB constraint is what stops a bad webhook payload becoming a permanent 4200
-- on someone's dashboard. NOT VALID would let existing rows through; there are
-- none, so a plain constraint is safe and checks future writes properly.
do $$
begin
  alter table public.calls
    add constraint calls_intent_score_extracted_range
    check (intent_score_extracted is null or intent_score_extracted between 0 and 100);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.leads
    add constraint leads_current_intent_score_range
    check (current_intent_score is null or current_intent_score between 0 and 100);
exception
  when duplicate_object then null;
end $$;

comment on column public.calls.intent_score_extracted is
  'Voice agent''s 0-100 read on buying intent for this conversation. Immutable '
  'per-call snapshot; null means the agent emitted no score, not a score of 0.';

comment on column public.leads.current_intent_score is
  'Latest intent_score rolled up from calls by lib/bolna/lead-merge.ts, subject '
  'to lead_field_overrides. Null means never scored.';
