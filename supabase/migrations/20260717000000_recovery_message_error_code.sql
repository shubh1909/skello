-- =============================================================================
-- 20260717000000 — Store Meta's numeric error code on WhatsApp messages.
-- =============================================================================
-- A message accepted by the BSP can still be rejected by Meta minutes later, and
-- the WHY is a numeric code: 131049 (per-user marketing cap) is a completely
-- different problem from 132001 (template not approved) — one is nothing to fix,
-- the other means the channel is dead until someone acts. We already classify
-- these (lib/whatsapp/error-codes.ts CODE_MAP), but the code only ever existed
-- inside the free-text error_message, recovered by regex.
--
--   shopify_recovery_messages.error_code integer  NEW. Meta's code (e.g. 131049),
--       taken straight off the delivery webhook's errors[] array. Null for
--       non-failures, for providers that send no code, and for pre-migration rows.
--
-- Why a column and not just the text: the text is the provider's, not ours — it
-- changes wording without notice, and "did this org hit template_paused this
-- week?" should be a WHERE clause, not a LIKE over prose.
-- =============================================================================

alter table public.shopify_recovery_messages
  add column if not exists error_code integer;

-- Fleet-wide triage: "which codes are we hitting, and for whom?" Partial — only
-- failures carry one, and they're a small minority of rows.
create index if not exists shopify_recovery_messages_error_code_idx
  on public.shopify_recovery_messages (organisation_id, error_code)
  where error_code is not null;

comment on column public.shopify_recovery_messages.error_code is
  'Meta Cloud API error code from the delivery webhook (e.g. 131049 marketing '
  'cap, 132001 template not found). Classified by lib/whatsapp/error-codes.ts '
  'into a disposition that decides retry vs skip vs hard-fail.';
