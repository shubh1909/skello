# Skelo

## Project Overview

Skelo is a high-performance, multi-tenant CRM designed for scale. This project prioritizes security, modularity, and a "Digital Showroom" aesthetic.

## Tech Stack

- **Frontend:** Next.js 15 (App Router, Server Components)
- **Backend:** Custom Node.js (via Server Actions) + Supabase
- **Database:** PostgreSQL with Row Level Security (RLS)
- **UI/UX:** shadcn/ui + Tailwind CSS

## Clean File Structure

Maintain this hierarchy to ensure a strict Separation of Concerns:

```
├── src/
│   ├── app/            # Next.js App Router (Pages, Routes, API handlers)
│   ├── actions/        # Server Actions (Business Logic & DB Mutations) — flat files
│   ├── components/     # UI Components (shadcn/ui & Custom)
│   ├── hooks/          # Reusable Client-side Logic
│   ├── lib/            # Supabase clients, shared utils, AND provider integrations
│   │                   #   (bolna/, kwikengage/, shopify/, whatsapp/, campaigns/…)
│   └── types/          # TypeScript Interfaces & DB Schemas
└── supabase/           # Migrations & RLS Policy Definitions
```

**There is no top-level `services/` directory.** Third-party integrations live under `src/lib/<provider>/`. Tests are colocated as `src/**/*.test.ts`.

## Project Laws (Strict Adherence Required)

### 1. Multi-Tenancy First

- **The Global Filter:** Every database query must include an `organisation_id` filter.
  - **Spelling is British.** The column is `organisation_id`; the table is `organisations`. `organization_id` does **not** exist in this codebase.
  - **`leads` is the exception:** it carries both `organisation_id` and a legacy `org_slug`. Filter by `organisation_id`, but write **both** on insert. See the `skelo-tenancy` skill before touching `leads`.
- **No Leaks:** Never use `SELECT *`, and never query without an org filter.
- **Backend Security:** All Server Actions must resolve the user's `organisation_id` from the session before execution — never from the client payload.
- **Service-role bypasses everything.** `createAdminClient()` drops both RLS tenant isolation *and* soft-delete filtering. Those paths must scope by hand.

### 2. Bespoke Engineering Only

- **No Off-The-Shelf:** Strictly avoid recommending Shopify, WordPress, or similar third-party builders.
- **Custom DNA:** Every module is built specifically for the Skelo ecosystem.

### 3. Component Strategy

- **Library:** Default to shadcn/ui.
- **Customization:** If a component is built from scratch, follow the Tactile Minimalism aesthetic referenced in `skills.md`.

### 4. Error & Edge Case Protocol

- **Standardized Response:** Every Server Action returns `ActionResult<T>` from `src/types/action.ts` — a **discriminated union**, not an optional-field bag. Use the `ok()` / `fail()` helpers; narrow on `success` before touching `data`.

  ```ts
  type ActionResult<T> =
    | { success: true; data: T }
    | { success: false; error: string };
  ```

- **Early Returns:** Handle edge cases (missing IDs, null values) at the top of functions to avoid "Pyramid of Doom" nesting.

## Engineering Principles

| Principle    | Agent Execution Strategy                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| DRY          | Extract repeated logic (e.g., currency formatting, auth checks) into `lib/` or `hooks/`.                 |
| KISS         | Avoid over-engineering. If a logic can be solved with a simple `map()`, do not build a complex utility class. |
| SOLID (SRP)  | One function = One task. A Server Action should not handle both "Update User" and "Send Marketing Email." |
| YAGNI        | Focus on the current ticket. Do not build "future-proof" features that aren't in the current scope.      |
| SoC          | Keep the UI (Components) "dumb." Move data fetching and mutations to Server Actions.                     |

## Operational Commands

- **Development:** `npm run dev`
- **Database Sync:** `npx supabase db pull`
- **Type Safety:** `tsc --noEmit`
- **Commit Check:** Before committing, verify Law #1 (Multi-tenancy) and Law #4 (Error Handling).

### Current domain model (headline tables)

- `organisations` — one per workspace; `owner_id = auth.uid()`.
- `leads` — CRM core. Tenant scope via `organisation_id` (with a legacy `org_slug` still written alongside). Pipeline `status` (enum: new → contacted → qualified → negotiating → won/lost), temperature **`current_intent`** (hot/warm/cold), `source` (enum: inbound_call / whatsapp / manual / import / web_form / shopify), plus `notes`, `city`, `pincode`.
  - ⚠️ **`lead_intent`, `interest`, and `customer_status` are NOT columns** — they were dropped in `20260517000003_cleanup.sql` and are derived on read from the `lead_data` JSONB. The `Lead` TypeScript type is **not** the table shape. Load the `skelo-leads` skill before querying. See [docs/api.md § Leads](docs/api.md#leads).
- `calls` — inbound + outbound. `direction` enum distinguishes them; `transcript` stores the raw blob; `transcript_status` drives the ingestion lifecycle. Tenant scope via `organisation_id`.
- `call_transcripts` — child table, one row per utterance. FTS GIN index on `to_tsvector('simple', text)` for multi-language search.
- `bolna_integrations` — per-org provider config (API key, agent id). RLS enabled with no authenticated policies; service-role only.
- `reminders` — per-lead + per-org follow-ups with `type` and `status` enums.

Migration files live under `supabase/migrations/`; [docs/api.md § Setup & Environment](docs/api.md#setup--environment) keeps the chronological list.

## Branding & Provider Naming

- **No third-party telephony vendor is ever named in the product.** User-facing copy, labels, tooltips, toasts, docs, and marketing pages refer to the feature as **"voice agent"** (lowercase in running copy, **"Voice Agent"** in titles). Never expose the vendor's brand in the CRM UI.
- When discussing the feature externally, say "Skelo's voice agent" or "voice agent integration" — not the underlying provider.
- This applies to new code, UI copy, error messages, marketing, and all documentation that ships with the product. Internal engineering comments, debug logs, and code identifiers are exempt (we may still reference the current provider internally for clarity), but those must not leak into anything a user can read.

## Third-Party Integrations

### Voice Agent (Telephony Provider)

Skelo is provider-agnostic at the product layer. A pluggable telephony provider powers the voice-driven lead pipeline.

- **Inbound Lead Capture:** The provider sends call transcripts, caller metadata, and extracted lead fields to a Skelo webhook. The webhook persists the lead under the correct `organization_id` (see Law #1).
- **Outbound Call Initiation:** Server Actions trigger the provider's API to place outbound calls (follow-ups, nurture sequences, verification). Call status updates flow back via webhook.
- **Implementation Location (internal, as it actually exists on disk):**
  - Provider client + core logic → `src/lib/bolna/` (**not** `services/bolna/` — that directory does not exist)
  - Webhook handlers → `src/app/api/webhooks/bolna/{leads,calls}/`
  - Outbound call Server Actions → `src/actions/calls.ts` (a flat file, **not** an `actions/calls/` directory)
  - A future rename to `services/telephony/` is tracked but **not executed**. Trust the filesystem over this document.
- **Security:** Verify webhook signatures before processing. Never trust `organization_id` from the webhook payload — resolve it server-side from the agent/phone-number mapping.
- **Internal note only (do not surface in UI):** the current implementation is Bolna.ai; a future rename of `services/bolna/` → `services/telephony/` is tracked but not yet executed.

## Domain Skills (load these before investigating, fixing, or extending)

This codebase has several traps that produce confident-but-wrong answers — dropped columns still present in TypeScript types, two competing implementations of the same concept, a half-finished tenancy migration, and paths this very document once described incorrectly. Each skill below carries verified `file:line` anchors, real column names, and a "known issues" section.

**Load the matching skill *before* reading code in that area. When unsure, load `skelo-tenancy`.**

| Skill | Load it for |
|---|---|
| `skelo-tenancy` | **Any** tenant-scoped query, Supabase client choice, auth/session, RLS, migrations, soft-delete. Highest frequency — the default. |
| `skelo-leads` | `leads`, `reminders`, `campaign_contacts`, `lead_data`/`custom_data` JSONB, extraction/merge, dedupe |
| `skelo-voice-agent` | `calls`, `call_transcripts`, `bolna_integrations`, `voice_agents`, dialling, call webhooks, transcripts |
| `skelo-whatsapp` | Template sends, delivery status, `whatsapp_integrations`, `shopify_recovery_messages`, KwikEngage |
| `skelo-recovery` | `shopify_recovery_*`, the Shopify webhook, App Proxy short links, conversion attribution, recovery metrics |
| `skelo-platform` | Cron, observability/Sentry, rate limits, campaign dispatch, analytics, CSV import/export, tests |

Domains overlap — a cart-recovery WhatsApp bug wants `skelo-recovery` **and** `skelo-whatsapp` **and** `skelo-tenancy`. Load all that apply.

### Where this document is wrong

This file has carried errors that actively caused bad code. If a skill contradicts `CLAUDE.md` or `backend-engineer-agent.md`, **the skill wins** — skills are verified against source. Corrected here so far: the org column spelling, the `services/bolna/` path, the `ActionResult` shape, and the `leads` column list. `docs/sitemap.md` dispatch throughput numbers are also stale.

## Agents

- **Backend Engineer:** See [backend-engineer-agent.md](backend-engineer-agent.md) — owns Server Actions, Supabase schema/auth/realtime, webhooks, and third-party integrations. Note it repeats the `organization_id` misspelling and describes webhook signing as HMAC-verified; both are corrected in `skelo-tenancy` and `skelo-voice-agent`.

## External References

- **Coding Standards & Aesthetics:** Refer to `skills.md` (To be added).
- **AI Agent Logic:** Refer to `agents.md`.
- **Backend API Reference:** [docs/api.md](docs/api.md).
- **UI Sitemap (routes, layouts, navigation flow):** [docs/sitemap.md](docs/sitemap.md).

@AGENTS.md
@backend-engineer-agent.md
