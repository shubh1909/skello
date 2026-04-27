-- Leads: align column naming with the product CRM vocabulary.
--
-- 1. `product` → `interest`
--    The column captures what the prospect is interested in (free-form text),
--    not a SKU. Renaming clarifies intent for both the UI and analytics.
--
-- 2. `summary` (new)
--    Short LLM-generated synopsis of the lead's last interaction. Free-form
--    text; trimmed at the application boundary.
--
-- 3. `contacted_on_watsapp` → `pending_action`
--    Inverts the semantics. `pending_action = true` means the operator still
--    owes the lead a follow-up; `false` means the loop is closed. Existing
--    rows are flipped accordingly so the action queue stays accurate. New
--    rows default to `true` so freshly captured leads surface automatically.

begin;

-- 1. Rename `product` → `interest`.
alter table public.leads
  rename column product to interest;

-- 2. Add `summary` column.
alter table public.leads
  add column if not exists summary text;

-- 3. Rename `contacted_on_watsapp` → `pending_action` and flip semantics.
alter table public.leads
  rename column contacted_on_watsapp to pending_action;

update public.leads
   set pending_action = case
         when pending_action is true then false  -- already contacted → done
         else true                                -- not yet contacted → still pending
       end;

alter table public.leads
  alter column pending_action set default true,
  alter column pending_action set not null;

commit;
