---
name: skelo-voice-agent
description: Skelo's voice agent / telephony domain (Bolna internally) — inbound call capture, outbound dialling, call lifecycle and status mapping, transcripts, org routing from agent/DID, campaigns dispatch, and the vendor-naming rule. Load this for any task touching calls, call_transcripts, bolna_integrations, voice_agents, campaign dialling, or the bolna webhooks.
---

# Skelo Voice Agent (internally: Bolna)

Load `skelo-tenancy` alongside this. For campaign dispatch internals see also `skelo-platform`.

## ⚠️ Naming rule (product-facing)

The vendor is **never** named in user-facing copy. UI says **"voice agent"** (lowercase in running copy, "Voice Agent" in titles). Internal identifiers, comments, and logs are exempt. Error strings deliberately say "voice provider". Never introduce the vendor brand into anything a user can read.

## ⚠️ `services/bolna/` does not exist

`CLAUDE.md` prescribes `services/<provider>/` and `actions/calls/`. **Reality:** `src/lib/bolna/` and a flat `src/actions/calls.ts`. The rename is tracked but not executed. Trust the filesystem.

## File map — `src/lib/bolna/`

| File | Role |
|---|---|
| `client.ts` | REST wrapper: `initiateBolnaCall`, `fetchBolnaExecution`, `pingBolna`, `BolnaApiError` |
| `inbound.ts` | `recordInboundCall`, `writeTranscriptTurns`, `mapStatus` |
| `outbound.ts` | `recordOutboundResult`, `bootstrapDirectOutboundCall` |
| `status-update.ts` | `applyCallStatusUpdate`, `mapBolnaStatus` (**canonical** status map) |
| `routing.ts` | `resolveOrgByAgentId`, `resolveOrgByDialedNumber` — the tenancy gate |
| `extract.ts` | `bolnaLeadPayloadSchema`, `extractLead` |
| `lead-merge.ts` | `mergePayloadIntoLead` — override-aware lead sync + call snapshot |
| `enrich.ts` | `enrichInboundLead` (**dead, no callers**), `enrichOutboundCall` |
| `transcript.ts` | `parseTranscript` (blob → turns) |
| `ip-allowlist.ts`, `calls-import.ts`, `csv.ts` | |

**Webhooks:** `src/app/api/webhooks/bolna/leads/route.ts` (primary, fat) and `.../calls/route.ts` (**near-dead**, see traps).

**Dispatchers** (all call `initiateBolnaCall`): `src/lib/campaigns/dispatch.ts:618`, `src/lib/callbacks/dispatch.ts:183`, `src/lib/shopify/recovery.ts:1061`.

**Actions:** `src/actions/calls.ts` (`initiateCall` :127, test call :311), `src/actions/bolna-integrations.ts`, `src/actions/voice-agents.ts`, `src/actions/admin/voice-agent.ts`, `src/actions/campaigns.ts`, `src/actions/voice-config.ts`.

## Inbound flow (`leads/route.ts`)

1. `:64` IP allowlist → `:74` shared secret → `:88` rate limit
2. `:109` `bolnaLeadPayloadSchema`
3. `:132` **branch**: `extracted_data == null` → pre-extraction lifecycle event → `mapBolnaStatus` → `applyCallStatusUpdate` (`ended_at` only when terminal, `:152`) → 200
4. `:175` `call_type === "outbound"` → `recordOutboundResult`
5. `:223` **org resolution: `resolveOrgByAgentId` → `:240` `resolveOrgByDialedNumber` → `:253` reject 400.** Disabled agent → 409.
6. `:265` `extracted_data.business_slug` mismatch is **advisory only** (LLM-emitted, untrusted) — logged, never routes
7. `:287` `recordInboundCall` → `mergePayloadIntoLead` → upsert `calls` on `(organisation_id, bolna_call_id)` → `writeTranscriptTurns`
8. `:305` `maybeScheduleInboundCallback` (best-effort, never fails the ack)

## Outbound flow

1. `actions/calls.ts:106` load integration → `:121` enabled check → `:127` `initiateBolnaCall` → error inserts a `failed` call row `:143`; success inserts with `bolna_call_id` `:157`
2. `client.ts:120` `coerceToE164`; POST `/call`; `:177` id = `execution_id ?? call_id ?? id`
3. Lifecycle webhooks → `applyCallStatusUpdate` → `status-update.ts:140` on `completed` schedules `enrichOutboundCall` via `after()`
4. Final extracted event → `outbound.ts:41` lookup by `bolna_call_id` → `:63` bootstrap if absent → `:88` test-call short-circuit → `:143` merge → `:199` transcripts → `:210/226/241` fan out to campaign / callback / recovery outcome handlers

## Tables

- **`calls`** — `organisation_id`, `lead_id`, `bolna_call_id`, `agent_id`, `direction` `inbound|outbound`, `status` `initiated|ringing|in_progress|completed|failed|no_answer|busy|canceled`, `transcript`, `transcript_status`, `duration_seconds`, `recording_url`, `started_at/answered_at/ended_at`, snapshot cols (`name_extracted`, `interest`, `lead_intent_extracted`, `actionable`, `customer_status`, `visit_scheduled_at`, `connect_on_whatsapp`, `call_outcome`, `requested_callback_at`, `lead_data`, `custom_data`), `is_test`, FKs to `campaign_contact_id` / `scheduled_callback_id` / `shopify_recovery_attempt_id`. **Unique `(organisation_id, bolna_call_id)`.**
- **`call_transcripts`** — `call_id`, `organisation_id`, `seq`, `speaker`, `text`, `started_ms`, `ended_ms`, `confidence`. Unique `(call_id, seq)`, FTS GIN on `to_tsvector('simple', text)`.
- **`bolna_integrations`** — PK `organisation_id`; `agent_id`, `api_key`, `from_phone_number`, `enabled`, `daily_calls_per_number`, `max_connected_calls_per_lead` (null = unlimited), `callbacks_enabled`, `callback_agent_id`, `callback_from_phone`. **RLS on, zero policies → service-role only.**
- **`voice_agents`** — PK `agent_id` (enforces one org per agent), `organisation_id`, `label`, `enabled`, `verified_at`.
- `transcript_status` enum: `pending|processing|ready|failed|skipped`.
- `CallOutcome` is an **open string** (per-org `org_outcome_policies`); `KNOWN_CALL_OUTCOMES` is defaults only.
- RPCs `resolve_org_by_agent`, `resolve_org_by_dialed_number` — service-role restricted.

## Env

`BOLNA_API_BASE_URL` (default `https://api.bolna.ai`), `BOLNA_WEBHOOK_SECRET`, `BOLNA_WEBHOOK_ALLOWED_IPS` (`*` or unset disables), `APP_DEFAULT_TIMEZONE` (default `Asia/Kolkata`).

## Gotchas

- **"Signature verification" is a misnomer.** `verifySecret` is a constant-time compare of a **static shared secret** — no HMAC, no body hashing, no replay protection. Accepted from the `x-bolna-signature` header **or a `?secret=` query param** (which lands in access logs). Missing `BOLNA_WEBHOOK_SECRET` fails closed. `backend-engineer-agent.md`'s "signed webhooks only" is aspirational, not current.
- **Routing source of truth is `voice_agents`**, not `bolna_integrations.agent_id` (that's the default/fallback). `campaigns.agent_id` is nullable and falls back to the integration's.
- **Transcript lifecycle:** `pending` → `processing` (only in `enrich.ts:174`) → `ready|skipped|failed`. Webhook paths jump straight to `ready`/`skipped`. **Both writers delete-then-insert turns** (`inbound.ts:190`, `enrich.ts:193`) — a transient zero-turn window, and enrichment can race the webhook writer on the same `call_id`.
- **Completed-status split:** campaign/callback/recovery contacts are finalised **only** in `recordOutboundResult`, never in `applyCallStatusUpdate` — the disposition arrives only on the extracted event. The 30-min in-flight reconcile is the backstop if that event never lands.
- Rate limits are **global across tenants** (shared provider IP pool). IP allowlist **fails open** when unset or `*`.
- `is_test` calls skip lead-merge and are excluded from stat cards — not real conversations.
- `daily_calls_per_number` defaults to 200 in **app code** (`actions/bolna-integrations.ts:31`), not in the DB.

## Hallucination traps

- **FOUR competing status maps with different unknown-value defaults.** Do not assume a shared mapper:
  | Mapper | Unknown value → |
  |---|---|
  | `status-update.ts:20` `mapBolnaStatus` (**canonical**) | `null` |
  | `inbound.ts:28` `mapStatus` | **`completed`** |
  | `actions/calls.ts:23` `normalizeBolnaStatus` | `initiated` |
  | `enrich.ts:260` `mapExecutionStatus` | raw string |

  `inbound.ts` and `enrich.ts` lack `queued`/`scheduled`/`answered`/`ringing`.
- **`/api/webhooks/bolna/calls` is near-dead** — folded into the `/leads` pre-extraction branch. It behaves differently (strict 400 on unknown status, 404 on not-found, reads flat fields `/leads` doesn't send). Deployments register `/leads`.
- **Two live transcript writers:** `writeTranscriptTurns` (webhook, blob in hand) vs `writeTranscript` (`enrich.ts:162`, REST pull, sets `processing`).
- **`enrichInboundLead` has no callers.** Only `enrichOutboundCall` is wired — and despite its name it runs for **any** `completed` call, including inbound.

## Timestamps — always parse provider values

`parseProviderTimestamp` exists because the provider emits **naive wall-clock** times in the app's zone. Every ingest path uses it: `inbound.ts:84-85`, `status-update.ts:96-97`, `enrich.ts:86-88,134`, and `outbound.ts` (`ended_at` in both the test-call and main update, `started_at` in `bootstrapDirectOutboundCall`).

**Never write `payload.updated_at` / `initiated_at` / `created_at` straight into a timestamptz column** — on a UTC host that silently shifts every value by the zone offset (~5.5h for IST). `outbound.ts` was fixed for exactly this.

## Provider-id lookups must detect collisions

`bolna_call_id` is unique **per-org** (`unique (organisation_id, bolna_call_id)`), not globally, and webhooks don't know the org at lookup time. So you cannot add an org filter — instead **fetch `.limit(2)` and refuse on >1 match**:

- `applyCallStatusUpdate` resolves candidates first, then updates **by primary key**. It previously did `.update().eq("bolna_call_id", …)`, which on a collision would have written across every tenant holding that id.
- `recordOutboundResult` refuses and logs rather than merging one tenant's extraction into another's call and lead.

Follow this pattern for any new lookup keyed on a provider-supplied id.

## 🐛 Known issue (still open)

**No status-monotonicity guard** — an out-of-order redelivery can regress `completed` → `ringing`. The WhatsApp path has a rank gate (`STATUS_RANK`); this one doesn't.
