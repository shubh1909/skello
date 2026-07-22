---
name: skelo-whatsapp
description: WhatsApp messaging in Skelo — the KwikEngage BSP integration, template sends, delivery-status webhooks, Meta error-code classification, retry/skip semantics, and the separate wa.me deep-link composer. Load this for any task touching WhatsApp sending, templates, delivery status, message logs, whatsapp_integrations, or shopify_recovery_messages.
---

# Skelo WhatsApp (KwikEngage BSP)

Load `skelo-tenancy` alongside this for org scoping and client selection.

## ⚠️ There are TWO unrelated "WhatsApp" systems

| System | Entry point | What it is |
|---|---|---|
| **BSP / KwikEngage** | `src/lib/kwikengage/client.ts` | Real API sends, approved Meta templates, delivery webhooks, `shopify_recovery_messages` |
| **wa.me deep link** | `src/components/app/whatsapp-dialog.tsx` | Manual composer for sales leads. Own hardcoded `TEMPLATES` array, own phone normaliser. **No API, no webhooks, no DB ledger.** |

"Template" means two different things. Confirm which system the task is about before touching anything.

**Two phone normalisers, not interchangeable:** `coerceToE164` (`src/lib/phone.ts`, BSP path) vs `normalisePhoneForWa` (`src/lib/format.ts`, deep-link path).

## File map (BSP path)

- `src/lib/whatsapp/provider.ts` — BSP-agnostic contract (`WhatsAppSendInput/Result/Provider`, `WhatsAppSendError`)
- `src/lib/whatsapp/registry.ts` — `getWhatsAppProvider(name)`; only `kwikengage` registered
- `src/lib/kwikengage/client.ts` — **the only place the KwikEngage HTTP shape exists**
- `src/lib/whatsapp/error-codes.ts` — Meta code → disposition → terminal status
- `src/lib/shopify/recovery-templates.ts` — layout → positional `variableOrder`
- `src/lib/shopify/whatsapp-recovery.ts` — **both** `dispatchDueWhatsAppRecoveries()` (outbound) and `applyWhatsAppDeliveryUpdate()` (inbound)
- `src/app/api/webhooks/kwikengage/route.ts` + `src/lib/kwikengage/webhook.ts` + `ip-allowlist.ts`
- Cron caller: `src/app/api/cron/campaigns/tick/route.ts:40` (the only one)

**Mutation surface trap:** `src/actions/whatsapp-integrations.ts` sounds like the CRUD file but is **read-only** (`getWhatsAppIntegration`). All writes live in `src/actions/admin/whatsapp.ts`.

## Outbound flow (`whatsapp-recovery.ts`)

1. `:60` reconcile `in_flight` older than 30 min → `failed`
2. `:80` select attempts where `whatsapp_status='pending'`, `converted_at is null`, `whatsapp_next_at <= now`, limit 100
3. `:95` filter `whatsapp_attempt < whatsapp_max_attempts && phone`
4. `:126` **call-window gate reuses the VOICE window** (`isWithinCallWindow`) — there is no separate WhatsApp schedule
5. `:156` template: settings override → integration default → else skip `no_template`
6. `:176` **CAS claim** `pending → in_flight`, guarded on `converted_at is null`
7. `:194` `provider.sendTemplate` → `coerceToE164` → POST `{base}/send-message/v2`, header `Authorization: <raw key>` (**no `Bearer`**)
8. `:210` insert `shopify_recovery_messages` (`sent`) → `:225` update attempt, guarded on `whatsapp_status='in_flight'`
9. `:238` on error: always log a `failed` message row, then `classifyWhatsAppError` → `terminalStatusFor`

## Inbound / delivery-status flow (`route.ts`)

1. `:47` IP allowlist → `:55` secret (`x-kwikengage-signature` header **or `?secret=`**) → `:75` rate limit
2. `:103` parse — **unparseable → 200 ok + ignored**, so the provider never retries. A parser gap is permanent data loss.
3. `:119` `after()` → `applyWhatsAppDeliveryUpdate` (`whatsapp-recovery.ts:317`)
4. `:325` lookup by `provider_message_id`
5. `:351` **monotonic rank gate** `queued0 < sent1 < delivered2 < read3 < failed4`
6. `:374` on failure advance the attempt, guarded on `whatsapp_status='sent'`

## Tables

- **`whatsapp_integrations`** — PK `organisation_id`. `provider` (default `kwikengage`), `api_token`, `base_url`, `sender_id`, `template_name`, `template_language` (default `en`), `config` jsonb, `enabled`. **RLS on, zero policies → service-role only.**
- **`shopify_recovery_messages`** — `provider_message_id`, `status` `queued|sent|delivered|read|failed`, `error_message`, `error_code`, `sent_at/delivered_at/read_at`, `shopify_recovery_attempt_id` (**no FK**). Unique partial index on `(organisation_id, provider_message_id)`.
- **`shopify_recovery_attempts`** (WhatsApp track) — `whatsapp_status` `none|pending|in_flight|sent|failed|skipped|canceled`, `whatsapp_attempt`, `whatsapp_max_attempts` (**default 1**), `whatsapp_next_at`, `whatsapp_sent_at`, `whatsapp_skip_reason`, `whatsapp_error`, `last_whatsapp_message_id`, `marketing_consent`
- **`shopify_recovery_settings`** — `whatsapp_enabled` (default **false**), `whatsapp_template_name`, `whatsapp_template_layout` (default `coupon_link`)

## Env

`KWIKENGAGE_API_BASE_URL` (default `https://api.kwikengage.ai`), `KWIKENGAGE_WEBHOOK_SECRET` (**required — unset rejects every webhook**), `KWIKENGAGE_WEBHOOK_ALLOWED_IPS` (unset or `*` disables the check), `KWIKENGAGE_WEBHOOK_DEBUG=1`.

## Gotchas

- **ID-shape correlation is the central fragility.** We store KwikEngage's `message_id_attr` (queue id) from the sync response. If a webhook reports Meta's `wamid.…`, nothing matches, the update returns `not_found`, and the message sits at `sent` forever while Meta actually rejected it. Both `route.ts:126` and `whatsapp-recovery.ts:341` log for exactly this.
- **`whatsapp_max_attempts` defaults to 1** — retries effectively don't happen unless an org raises it.
- Disposition → status: `capped`/`opted_out`/`undeliverable` → `skipped` (soft); `config` → `failed`; `rate_limited`/`transient`/`unknown` → retry.
- **Template param sanitisation** (`client.ts:56`): empty/newline/tab/4+ spaces cause an un-itemised Meta 400. Blank values become `"-"`.
- `coerceToE164` defaults bare 10-digit numbers to **+91**; `client.ts:75` then strips the `+`.
- **`delivered`/`read` do NOT stop voice escalation** — only conversion does. The attempt's terminal WhatsApp state is `sent`; `delivered`/`read` live only on the message ledger.
- **`variableOrder` has no default by design.** Adding a fallback silently sends a 6-param classic payload at a 4-param `coupon_link` template.
- **`sender_id` is stored, validated, and shown in the UI but never sent** — `client.ts` reads it into the type and ignores it.
- **`template_id` is not an id** — it's the template *name* string.
- **Dead columns:** `20260704000000` creates `first_channel` and `escalation_gap_minutes`; `20260711000000` **drops both**. Reading only the first migration gives you a channel-ordering model that no longer exists.

## Provider-id lookups must detect collisions

`provider_message_id` is unique **per-org** (partial index), not globally, and the webhook doesn't know the org at lookup time — so an org filter isn't available. `applyWhatsAppDeliveryUpdate` instead fetches `.limit(2)`, **refuses on >1 match**, and **captures the query error** (it previously destructured only `data`, making every DB fault indistinguishable from a clean miss). Same pattern as the voice domain — see `skelo-voice-agent`.

## 🐛 Known issue (still open)

**Marketing consent is captured but never enforced.** `src/lib/shopify/recovery.ts:164` messages every cart with a phone regardless of `marketing_consent`. The only opt-out handling is reactive (Meta code 131050, after the send). Compliance exposure — not yet fixed.
