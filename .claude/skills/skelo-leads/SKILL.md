---
name: skelo-leads
description: Skelo's leads/CRM core — the leads table's true post-remodel shape, the Lead TS type vs table-shape divergence, pipeline/intent/source enums, phone dedupe, the two find-or-create paths, lead field overrides, reminders, and campaigns. Load this for any task touching leads, reminders, campaign_contacts, lead_data/custom_data JSONB, or lead extraction/merge.
---

# Skelo Leads / CRM Core

Load `skelo-tenancy` alongside — `leads` is the dual-keyed table and has a known soft-delete RLS bug.

## ⚠️ The baseline schema is obsolete

`supabase/migrations/20260507000000_baseline_schema.sql` defines `leads` with columns that **were later dropped**. Reading only the baseline produces wrong answers. The real shape comes from:

- `20260517000001_lead_call_remodel.sql` — adds `organisation_id`, `phone_normalized` (**generated**, digits-only via `regexp_replace`), `first_seen_at`, `last_contact_at`, **`current_intent`**; seeds `current_intent` from `lead_intent` and merges duplicates
- `20260517000003_cleanup.sql:54-62` — **DROPS** `external_id`, `interest`, `summary`, `actionable`, `recording_url`, `customer_status`, `wants_to_connect_on_watsapp`, `visit_date_time`, `lead_intent`, `search_tsv`
- `20260517000004_post_cleanup_fixes.sql:17` — drops the legacy `lead_call_activity(uuid,text,boolean,int,int)` RPC; the baseline RPC returning `lead_intent` is **dead code**

### `leads.lead_intent` DOES NOT EXIST — it is `current_intent`

## ⚠️ The `Lead` TypeScript type is NOT the table shape

`src/types/lead.ts:64` declares `lead_intent: LeadIntent | null` as a **back-compat derived field** ("alias for current_intent"), computed on read by `actions/leads.ts` — alongside `interest`, `customer_status`, `wants_to_connect_on_watsapp`, `visit_date_time`, all dug out of the `lead_data` JSONB.

**Passing these names to `.select()` compiles fine and fails at runtime.** TypeScript will not catch it.

### 🐛 Live bug caused by exactly this

`src/actions/shopify-recovery.ts:987`:
```ts
.select("id, name, status, lead_intent")   // lead_intent was dropped
```
PostgREST returns error 42703. The code **never checks `leadsRes.error`** and iterates `leadsRes.data ?? []` (`:1008`), so the map stays empty and `name`/`status`/`lead_intent` silently render null for *every* lead in that recovery view. Silent degradation, not a crash. Fix: select `current_intent` and alias it.

## Enums (current)

- **`lead_status`** (pipeline): `new, contacted, qualified, negotiating, won, lost`
- **`intent_type`** → column `current_intent`: `hot, warm, cold`
- **`lead_source`**: `inbound_call, whatsapp, manual, import, web_form` **+ `shopify`** (added by `20260628000000` via `ADD VALUE IF NOT EXISTS`)
- `campaigns.status` is a **separate CHECK constraint**, not this enum: `draft, scheduled, in_progress, paused, stopped, completed, failed`

## Phone dedupe

Final index (`20260623000001:66`) is **partial**:
```sql
unique (organisation_id, phone_normalized)
  where phone_normalized is not null and deleted_at is null
```
Soft-deleting a lead **frees its phone slot**, so a new interaction creates a fresh visible lead rather than merging into a handed-over one. **Any find-or-create MUST filter `deleted_at IS NULL`** or it will match an invisible row and miss/violate the constraint.

## ⚠️ THREE phone normalisations — deliberately different

| Where | Rule | Purpose |
|---|---|---|
| `leads.phone_normalized` (generated col) | all digits | dedupe |
| `src/lib/shopify/lead.ts:7` | all digits (mirrors the generated col in TS) | find-or-create matching |
| `recovery.ts:389` `phoneKey` | **last 10 digits only** | country-code-tolerant attribution |

Plus `coerceToE164` (`lib/phone.ts`, dialling/BSP) and `normalisePhoneForWa` (`lib/format.ts`, wa.me links). Conflating them breaks either dedupe or attribution.

## Two find-or-create implementations — both correct, different scopes

1. **`src/lib/shopify/lead.ts:32` `findOrCreateShopifyLead`** — lookup by `(organisation_id, phone_normalized)` + `deleted_at IS NULL` (`:47-53`); handles the insert race on `error.code === '23505'` by refetching (`:94`); returns `null` when there's no phone (`:37`).
2. **`src/lib/bolna/lead-merge.ts` `mergePayloadIntoLead`** — the richer path: extraction, `lead_field_overrides` locking (`OVERRIDEABLE_LEAD_FIELDS`, `:41`), and `FIRST_CLASS_LEAD_DATA_KEYS` promoted to `calls` columns while everything else lands in `custom_data` with `category=''`.

Custom-field categories: `""` is canonical (from `apply_lead_field_jsonb`); `"__general__"` and `"general"` are legacy webhook aliases (`src/lib/csv-custom-fields.ts:35`).

## Reminders

`reminders` (baseline `:237`): `organisation_id`, `lead_id` (**`ON DELETE SET NULL`** — reminders survive lead deletion), `remind_at`, `type` CHECK `call|whatsapp|email|visit|other`, `status` CHECK `pending|done|dismissed`, `completed_at`. **Both are CHECK constraints, not enums.**

Distinct from `scheduled_callbacks` (`20260615000000`), which is the **automated dialler queue**, not user reminders. UI at `src/app/(app)/reminders`.

## Campaigns (lead-facing surface)

`campaigns` + `campaign_contacts` (`20260508000000`).

- `agent_id` nullable → falls back to `bolna_integrations.agent_id`
- `max_attempts` CHECK is `1..6` in baseline but **raised to 10** by `20260609000000_campaign_max_attempts_10.sql` — always check the later migration
- `retry_on` is `text[]` constrained `<@ array['no_answer','busy','failed','canceled']`
- `campaign_contacts.status`: `pending|in_flight|succeeded|failed|skipped`
- **Denormalised counters (`succeeded_count`, etc.) are trigger-maintained — never write them directly**

Dispatch internals live in `skelo-platform`.

## Trap summary

| Trap | Reality |
|---|---|
| `leads.lead_intent` | Dropped — use `current_intent` |
| `Lead` TS interface = table shape | It is not; ~6 fields are computed on read |
| `leads.interest` / `customer_status` / `visit_date_time` | Derived from `lead_data` JSONB, not columns |
| Baseline `lead_call_activity` RPC | Dropped in `20260517000004` |
| One phone normaliser | Three (plus two more elsewhere), intentionally |
| Reminders `type`/`status` are enums | CHECK constraints |
| `scheduled_callbacks` = reminders | No — it's the dialler queue |
| Reading only the baseline migration | Obsolete; read the remodel + cleanup migrations |
