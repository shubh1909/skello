# Skello

## Project Overview

Skello is a high-performance, multi-tenant CRM designed for scale. This project prioritizes security, modularity, and a "Digital Showroom" aesthetic.

## Tech Stack

- **Frontend:** Next.js 15 (App Router, Server Components)
- **Backend:** Custom Node.js (via Server Actions) + Supabase
- **Database:** PostgreSQL with Row Level Security (RLS)
- **UI/UX:** shadcn/ui + Tailwind CSS

## Clean File Structure

Maintain this hierarchy to ensure a strict Separation of Concerns:

```
├── app/                # Next.js App Router (Pages & Routes)
├── actions/            # Server Actions (Business Logic & DB Mutations)
├── components/         # UI Components (shadcn/ui & Custom)
├── hooks/              # Reusable Client-side Logic
├── lib/                # Config (Supabase Client, Shared Utils)
├── services/           # Third-party Integrations (telephony provider, payments)
├── types/              # TypeScript Interfaces & DB Schemas
└── supabase/           # Migrations & RLS Policy Definitions
```

## Project Laws (Strict Adherence Required)

### 1. Multi-Tenancy First

- **The Global Filter:** Every database query must include an `organization_id` filter.
- **No Leaks:** Never use `SELECT *` without a `WHERE organization_id = ...` clause.
- **Backend Security:** All Server Actions must verify the user's `organization_id` from the session before execution.

### 2. Bespoke Engineering Only

- **No Off-The-Shelf:** Strictly avoid recommending Shopify, WordPress, or similar third-party builders.
- **Custom DNA:** Every module is built specifically for the Skello ecosystem.

### 3. Component Strategy

- **Library:** Default to shadcn/ui.
- **Customization:** If a component is built from scratch, follow the Tactile Minimalism aesthetic referenced in `skills.md`.

### 4. Error & Edge Case Protocol

- **Standardized Response:** Every Server Action must return this shape:

  ```ts
  { success: boolean, data?: T, error?: string }
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
- `leads` — CRM core. Tenant scope via `org_slug`. Columns include pipeline `status` (enum: new → contacted → qualified → negotiating → won/lost), temperature `lead_intent` (hot/warm/cold), `source` (enum: inbound_call / whatsapp / manual / import / web_form), plus `notes`, `city`, `pincode`, and a free-form `customer_status` ("buyer type"). See [docs/api.md § Leads](docs/api.md#leads).
- `calls` — inbound + outbound. `direction` enum distinguishes them; `transcript` stores the raw blob; `transcript_status` drives the ingestion lifecycle. Tenant scope via `organisation_id`.
- `call_transcripts` — child table, one row per utterance. FTS GIN index on `to_tsvector('simple', text)` for multi-language search.
- `bolna_integrations` — per-org provider config (API key, agent id). RLS enabled with no authenticated policies; service-role only.
- `reminders` — per-lead + per-org follow-ups with `type` and `status` enums.

Migration files live under `supabase/migrations/`; [docs/api.md § Setup & Environment](docs/api.md#setup--environment) keeps the chronological list.

## Branding & Provider Naming

- **No third-party telephony vendor is ever named in the product.** User-facing copy, labels, tooltips, toasts, docs, and marketing pages refer to the feature as **"voice agent"** (lowercase in running copy, **"Voice Agent"** in titles). Never expose the vendor's brand in the CRM UI.
- When discussing the feature externally, say "Skello's voice agent" or "voice agent integration" — not the underlying provider.
- This applies to new code, UI copy, error messages, marketing, and all documentation that ships with the product. Internal engineering comments, debug logs, and code identifiers are exempt (we may still reference the current provider internally for clarity), but those must not leak into anything a user can read.

## Third-Party Integrations

### Voice Agent (Telephony Provider)

Skello is provider-agnostic at the product layer. A pluggable telephony provider powers the voice-driven lead pipeline.

- **Inbound Lead Capture:** The provider sends call transcripts, caller metadata, and extracted lead fields to a Skello webhook. The webhook persists the lead under the correct `organization_id` (see Law #1).
- **Outbound Call Initiation:** Server Actions trigger the provider's API to place outbound calls (follow-ups, nurture sequences, verification). Call status updates flow back via webhook.
- **Implementation Location (internal):**
  - Provider client + API wrappers → `services/<provider>/` (current: `services/bolna/`)
  - Webhook handlers → `app/api/webhooks/<provider>/`
  - Outbound call Server Actions → `actions/calls/`
- **Security:** Verify webhook signatures before processing. Never trust `organization_id` from the webhook payload — resolve it server-side from the agent/phone-number mapping.
- **Internal note only (do not surface in UI):** the current implementation is Bolna.ai; a future rename of `services/bolna/` → `services/telephony/` is tracked but not yet executed.

## Agents

- **Backend Engineer:** See [backend-engineer-agent.md](backend-engineer-agent.md) — owns Server Actions, Supabase schema/auth/realtime, webhooks, and third-party integrations.

## External References

- **Coding Standards & Aesthetics:** Refer to `skills.md` (To be added).
- **AI Agent Logic:** Refer to `agents.md`.
- **Backend API Reference:** [docs/api.md](docs/api.md).
- **UI Sitemap (routes, layouts, navigation flow):** [docs/sitemap.md](docs/sitemap.md).

@AGENTS.md
@backend-engineer-agent.md
