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
├── services/           # Third-party Integrations (Bolna, Razorpay)
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

## Third-Party Integrations

### Bolna.ai (Voice AI)

Skello integrates with [Bolna.ai](https://www.bolna.ai/docs) to power its voice-driven lead pipeline.

- **Inbound Lead Capture:** Bolna sends call transcripts, caller metadata, and extracted lead fields to a Skello webhook endpoint. The webhook persists the lead under the correct `organization_id` (see Law #1).
- **Outbound Call Initiation:** Server Actions trigger Bolna's API to place outbound calls (follow-ups, nurture sequences, verification). Call status updates flow back via webhook.
- **Implementation Location:**
  - Bolna client + API wrappers → `services/bolna/`
  - Webhook handlers → `app/api/webhooks/bolna/`
  - Outbound call Server Actions → `actions/calls/`
- **Security:** Verify Bolna webhook signatures before processing. Never trust `organization_id` from the webhook payload — resolve it server-side from the agent/phone-number mapping.
- **Docs:** https://www.bolna.ai/docs

## Agents

- **Backend Engineer:** See [backend-engineer-agent.md](backend-engineer-agent.md) — owns Server Actions, Supabase schema/auth/realtime, webhooks, and third-party integrations.

## External References

- **Coding Standards & Aesthetics:** Refer to `skills.md` (To be added).
- **AI Agent Logic:** Refer to `agents.md`.
- **Backend API Reference:** [docs/api.md](docs/api.md).
- **UI Sitemap (routes, layouts, navigation flow):** [docs/sitemap.md](docs/sitemap.md).
- **Bolna.ai API:** https://www.bolna.ai/docs

@AGENTS.md
@backend-engineer-agent.md
