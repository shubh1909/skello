-- Multi-agent + multi-from-number support for campaigns.
--
-- Until now `bolna_integrations` held one agent_id and one from_phone_number
-- per org — the "default" voice agent and caller ID. Campaigns inherited
-- both. We're adding a second tier of OPTIONAL extras so a tenant can keep
-- multiple agents (e.g. "Sales follow-up", "Renewal nurture") and multiple
-- caller IDs and pick which combination a given campaign should use.
--
-- Shape:
--   bolna_integrations.agent_id            text NOT NULL          (unchanged) — default
--   bolna_integrations.agent_ids           text[] DEFAULT '{}'    NEW       — additional ids
--   bolna_integrations.agent_labels        jsonb  DEFAULT '{}'    NEW       — { id: label }
--   bolna_integrations.from_phone_number   text                   (unchanged) — default
--   bolna_integrations.from_phone_numbers  text[] DEFAULT '{}'    NEW       — additional numbers
--   bolna_integrations.from_phone_labels   jsonb  DEFAULT '{}'    NEW       — { phone: label }
--
--   campaigns.from_phone_number            text   nullable        NEW       — campaign-level override
--   campaigns.agent_id                     text   nullable        (unchanged) — already supported
--
-- The dispatcher (cron tick) resolves a per-call (agent_id, from_phone)
-- as: `coalesce(campaigns.agent_id, bolna_integrations.agent_id)` and the
-- mirror for from_phone. So existing campaigns with both nulls behave
-- exactly as before. New campaigns can override either.

alter table public.bolna_integrations
  add column if not exists agent_ids          text[]  not null default '{}'::text[],
  add column if not exists agent_labels       jsonb   not null default '{}'::jsonb,
  add column if not exists from_phone_numbers text[]  not null default '{}'::text[],
  add column if not exists from_phone_labels  jsonb   not null default '{}'::jsonb;

-- Sanity: keep the additional arrays free of empty strings so the picker
-- never renders a blank option. Defensive at the DB layer; the action
-- layer trims before insert too.
alter table public.bolna_integrations
  drop constraint if exists bolna_integrations_agent_ids_nonblank;
alter table public.bolna_integrations
  add constraint bolna_integrations_agent_ids_nonblank
  check (not (array['' ::text] && agent_ids));

alter table public.bolna_integrations
  drop constraint if exists bolna_integrations_from_phone_numbers_nonblank;
alter table public.bolna_integrations
  add constraint bolna_integrations_from_phone_numbers_nonblank
  check (not (array['' ::text] && from_phone_numbers));

alter table public.campaigns
  add column if not exists from_phone_number text
    check (from_phone_number is null or char_length(from_phone_number) between 5 and 32);
