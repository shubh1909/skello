# Skelo Sitemap

A map of every route in the app, who can reach it, what it renders, and how the user moves through it. Pair this with [api.md](api.md) for the server-side surface.

---

## Table of Contents

1. [Route Tree](#route-tree)
2. [Route Reference](#route-reference)
3. [Navigation Flow](#navigation-flow)
4. [Layouts & Route Groups](#layouts--route-groups)
5. [Shared App Components](#shared-app-components)
6. [Auth Gating Rules](#auth-gating-rules)

---

## Route Tree

```
/                           → Marketing landing
├── /login                  → Sign in
├── /signup                 → Create workspace (regular users only)
├── /onboarding             → Org bootstrap (rare fallback)
├── /api/
│   ├── webhooks/bolna/*    → External webhooks (no UI)
│   ├── leads/export        → Authenticated CSV export (GET)
│   ├── campaigns/[id]/export → Authenticated campaign-results CSV (GET)
│   └── cron/campaigns/tick → Cron drainer; called by pg_cron each minute (POST, secret-gated)
│
├── (admin)/                → Platform-admin shell — separate sidebar
│   └── /admin
│       ├── /                    → Overview (org counts, voice agent states)
│       ├── /organisations       → List every workspace
│       ├── /organisations/[id]  → Edit org info + provision voice agent
│       └── /users               → Promote / demote admins
│
└── (app)/                  → Authenticated shell — sidebar + topbar
    ├── Overview
    │   └── /dashboard      → Analytics (range-filtered KPIs, charts)
    │   (/pulse exists but is hidden — see Hidden routes below)
    ├── Leads
    │   ├── /leads          → Lead CRM table + export + column resize
    │   └── /conversations  → Inbound + outbound call log w/ filters & realtime
    ├── Outreach            → three siblings; Cart Recovery and COD are independent
    │   │                      engines that merely live under /campaigns/… in the URL
    │   ├── /campaigns      → Bulk outbound: CSV upload, schedule/run, retries, live progress
    │   ├── /campaigns/templates/cart-recovery   → Abandoned-checkout recovery workspace
    │   └── /campaigns/templates/cod-confirmation → COD order-confirmation calls
    ├── System
    │   ├── /integrations   → Lead sources + connected apps, one tab per integration
    │   ├── /settings       → Workspace, data import, account
    │   ├── /developer      → Placeholder (Access denied)
    │   └── /billing        → Placeholder (Access denied)
    └── /reminders          → Reminder list (not in sidebar; linked from
                              dashboard widgets and the lead detail sheet)
```

`(app)` is a Next.js [route group](https://nextjs.org/docs/app/getting-started/layouts-and-pages) — the parentheses do not appear in the URL. Everything inside it shares the dashboard chrome and is gated by `requireSession()`. Sidebar headings (Overview / Leads / Outreach / System) are purely visual grouping — they are not URL segments.

---

## Route Reference

| URL | File | Auth | Purpose |
| --- | --- | --- | --- |
| `/` | [src/app/page.tsx](../src/app/page.tsx) | Public · redirects to `/dashboard` if signed in | Marketing landing — hero, features, dashboard preview, CTA |
| `/login` | [src/app/login/page.tsx](../src/app/login/page.tsx) | Public · redirects to `/dashboard` if signed in | Email + password sign in |
| `/signup` | [src/app/signup/page.tsx](../src/app/signup/page.tsx) | Public · redirects to `/dashboard` if signed in | Email + password + workspace name; creates org via `signUp()` |
| `/onboarding` | [src/app/onboarding/page.tsx](../src/app/onboarding/page.tsx) | Authed · redirects to `/dashboard` if user has any org | Fallback when an authed user has no org (e.g. org was deleted) |
| `/dashboard` | [src/app/(app)/dashboard/page.tsx](../src/app/(app)/dashboard/page.tsx) | Authed + org required | **Analytics dashboard** — range toggle (24h/7d/14d/30d), 4 KPI cards (total calls, unique users, avg duration, qualified rate), Daily New Leads bar chart, Product Interest ranking, Lead Temperature stacked chart, Call Outcomes breakdown |
| `/pulse` | [src/app/(app)/pulse/page.tsx](../src/app/(app)/pulse/page.tsx) | Authed + org required · **hidden from sidebar (2026-04-28)** — reachable only by deep link | Operator snapshot — hot-but-uncontacted alert card, recent leads, upcoming reminders, recent calls |
| `/leads` | [src/app/(app)/leads/page.tsx](../src/app/(app)/leads/page.tsx) | Authed + org required | One row per unique phone, rendered by `LeadsActivityTable`. Query: `?include=all` (include zero-call leads) and `?q=` (server-side search). Middle columns are **catalog-driven** from `lead_field_definitions` and drag-resizable (persisted in `localStorage`). 3 lifetime stat cards. Realtime via `useLeadsRealtime`. |
| `/conversations` | [src/app/(app)/conversations/page.tsx](../src/app/(app)/conversations/page.tsx) | Authed + org required | Unified call log (inbound + outbound). Columns: Call ID, Lead / Number, Date & Time, Duration, Direction, Outcome, Audio. Filter bar: Range (24h / 7d / 30d / all), Agent, Outcome, Direction, search. Click a row → `CallTranscriptDialog`. **Audio → Play** opens `recording_url`. Realtime updates via `useCallsRealtime`. |
| `/campaigns` | [src/app/(app)/campaigns/page.tsx](../src/app/(app)/campaigns/page.tsx) | Authed + org required | **Bulk outbound calling.** Header + 4 stat cards (Total / Running / Scheduled / Completed) + the campaigns table (ID, File, Contacts `valid/total`, Status, Progress bar `succeeded·in-flight·failed`, Workflow, Created, row actions). Click the ID or the list icon → call-log sheet. New-campaign button opens [`CampaignUploadDialog`](../src/components/app/campaign-upload-dialog.tsx) (drag-and-drop CSV, run-now or schedule, retries 0–5, retry interval, retry-on triggers). Realtime via `useCampaignsRealtime`. See [api.md § Campaigns](api.md#campaigns-bulk-outbound). |
| `/reminders` | [src/app/(app)/reminders/page.tsx](../src/app/(app)/reminders/page.tsx) | Authed + org required | Tabbed reminder list. Query: `?status=pending\|done\|dismissed` (default `pending`). Not in sidebar — reached from dashboard widgets and the lead detail sheet. |
| `/integrations` | [src/app/(app)/integrations/page.tsx](<../src/app/(app)/integrations/page.tsx>) | Authed + org required | **Read-only.** One tab per integration (`?tab=`): **Google Ads** and **WhatsApp** (live — webhook URL, self-issued key/verify token, setup steps, delivery log with raw payloads and re-run), **99acres** (not built — states what the customer must supply), **Voice agent** and **Shopify** (the status cards moved off `/settings`). Provisioning is admin-only, at `/admin/organisations/[id]/integrations`, which mirrors these tabs one-for-one. See [docs/integrations-plan.md](integrations-plan.md). |
| `/settings` | [src/app/(app)/settings/page.tsx](../src/app/(app)/settings/page.tsx) | Authed + org required | Workspace, CSV call import, account. The connection cards moved to `/integrations` (2026-08-12). |
| `/developer` | [src/app/(app)/developer/page.tsx](../src/app/(app)/developer/page.tsx) | Authed + org required | Placeholder — role-gated (Access denied) |
| `/billing` | [src/app/(app)/billing/page.tsx](../src/app/(app)/billing/page.tsx) | Authed + org required | Placeholder — owner-gated (Access denied) |
| `GET /api/leads/export` | [src/app/api/leads/export/route.ts](../src/app/api/leads/export/route.ts) | Session-authed | CSV download. Query: `?range=today\|yesterday\|last_week\|last_month\|all`. Scoped to the caller's org. |
| `GET /api/campaigns/[id]/export` | [src/app/api/campaigns/[id]/export/route.ts](../src/app/api/campaigns/[id]/export/route.ts) | Session-authed | Campaign-results CSV. One row per `campaign_contacts` entry: phone, name, status, attempts, next attempt, last call status/error/timing/recording. No file is stored — the CSV is built on the fly. |
| `POST /api/cron/campaigns/tick` | [src/app/api/cron/campaigns/tick/route.ts](../src/app/api/cron/campaigns/tick/route.ts) | Header `x-cron-secret` must equal `CRON_SECRET` | Drainer. Called every minute by `pg_cron`. Promotes due `scheduled` campaigns to `in_progress`, then fires up to `BATCH_LIMIT = 250` calls per tick (`PER_CAMPAIGN_LIMIT = 100` for fairness, `CONCURRENCY = 25`) via `initiateBolnaCall` — see [dispatch.ts](../src/lib/campaigns/dispatch.ts) for the live values. One tick drains four subsystems via `Promise.allSettled` (campaigns, callbacks, Shopify recovery, WhatsApp recovery); it returns 500 only if all four reject. See [api.md § Campaigns](api.md#campaigns-bulk-outbound). |
| `POST /api/webhooks/bolna/leads` | [src/app/api/webhooks/bolna/leads/route.ts](../src/app/api/webhooks/bolna/leads/route.ts) | Signed (header `x-bolna-signature` or `?secret=`) | **Unified post-call webhook.** Dispatches on `telephony_data.call_type`: inbound → creates lead + records call inline (`recordInboundCall`); outbound → patches the existing call row from `initiateCall` and flows extraction back to the lead (`recordOutboundResult`). Same URL on every Bolna agent regardless of direction. See [api.md](api.md#voice-agent-webhooks). |
| `POST /api/webhooks/bolna/calls` | [src/app/api/webhooks/bolna/calls/route.ts](../src/app/api/webhooks/bolna/calls/route.ts) | Signed | **Legacy** status-only updater. Superseded by the unified `/api/webhooks/bolna/leads` route for new agent configurations; kept for backward compatibility. |
| `POST /api/webhooks/google-ads/[token]` | [route.ts](../src/app/api/webhooks/google-ads/[token]/route.ts) | Org resolved from the URL token; `google_key` echoed in the body, constant-time compare | Google Ads lead-form submissions. ⚠️ **Response contract is the inverse of Shopify's** — 4xx is never retried, 5xx is, so a failed ledger write must return 503. `is_test` deliveries are recorded and create no lead. See [api.md § Lead Intake](api.md#lead-intake-google-ads--whatsapp--portals). |
| `GET/POST /api/webhooks/whatsapp/[token]` | [route.ts](../src/app/api/webhooks/whatsapp/[token]/route.ts) | GET: `hub.verify_token` handshake. POST: `X-Hub-Signature-256` over the raw body, with *that org's* `app_secret` | Click-to-WhatsApp lead capture, Meta Cloud API direct. Resolve the tenant from the token **before** verifying — the secret is per-org. Creates a lead on an ad `referral` or an unknown sender; known senders with no referral are acked and dropped. |
| `GET/POST /api/webhooks/portal/[token]` | [route.ts](../src/app/api/webhooks/portal/[token]/route.ts) | Token; optional `api_key` (query or `X-Api-Key`); optional per-source IP allowlist | 99acres and future property portals. Accepts JSON, form-encoded and query-string alike — the `Content-Type` header is not trusted. No schema exists; field names are learned from deliveries via the admin mapping editor. |
| `/admin` | [src/app/(admin)/admin/page.tsx](../src/app/(admin)/admin/page.tsx) | **Admin required** (`requireAdmin()`) | Platform-admin overview — org counts, voice agent states, recent signups |
| `/admin/organisations` | [src/app/(admin)/admin/organisations/page.tsx](../src/app/(admin)/admin/organisations/page.tsx) | Admin required | Every workspace, searchable by name or slug |
| `/admin/organisations/[id]` | [src/app/(admin)/admin/organisations/[id]/page.tsx](../src/app/(admin)/admin/organisations/[id]/page.tsx) | Admin required | Edit org name/slug, view owner, integration summary; links to per-org config (integrations, lead fields, dashboard, call outcomes) |
| `/admin/organisations/[id]/integrations` | [page.tsx](<../src/app/(admin)/admin/organisations/[id]/integrations/page.tsx>) | Admin required | **Every connection, one tab each** (`?tab=`): Google Ads · WhatsApp · 99acres · Voice agent · Cart recovery. Provisions lead-source webhook endpoints, holds client credentials (write-only), and carries the 99acres field-mapping editor. Mirrors the customer's `/integrations` tabs one-for-one. `…/voice-agents` and `…/shopify` are **redirects** into this page — kept because the Shopify OAuth install flow returns to `…/shopify`. |
| `/admin/organisations/[id]/outcomes` | [src/app/(admin)/admin/organisations/[id]/outcomes/page.tsx](../src/app/(admin)/admin/organisations/[id]/outcomes/page.tsx) | Admin required | Per-org call-outcome policy — for each outcome set the action (succeed / fail / callback / retry) and whether it counts as success; **click-to-rank priority** order (top 5 drive the campaign Best disposition); shows the outcome keys to paste into the voice agent |
| `/admin/users` | [src/app/(admin)/admin/users/page.tsx](../src/app/(admin)/admin/users/page.tsx) | Admin required | List every user, promote / demote admin — self-demotion blocked |

> Routes not listed here do not exist. The middleware refreshes the Supabase session on every request but does **not** itself enforce route guards — guarding lives inside `requireSession()` and the auth pages' redirect checks.

> **Hidden routes (2026-04-28):** `/pulse` is no longer linked from the sidebar. The page still renders for anyone who deep-links to it, but it is not part of the discoverable navigation. The decision was product-driven: the dashboard already covers the operator snapshot well enough, and the duplicate landing surface added cognitive overhead. Removal of the route file is deferred until we are certain no internal tooling links to it. See [src/components/app/sidebar-nav.tsx](../src/components/app/sidebar-nav.tsx) — the Overview group now contains only `/dashboard`.

> **Terminology:** the product refers to the telephony feature as **"voice agent"** (lowercase in copy, "Voice Agent" in titles) — never by the underlying provider name. Internal file paths (`services/bolna/`, `app/api/webhooks/bolna/`) still reference the current provider; see [CLAUDE.md](../CLAUDE.md) → *Branding & Provider Naming*.

---

## Navigation Flow

```
                         ┌──────────────────────┐
                         │   Unauthed visitor   │
                         └──────────┬───────────┘
                                    │
                          ┌─────────▼─────────┐
                          │        /          │
                          │   Landing page    │
                          └─┬────────┬────────┘
                            │        │
                  ┌─────────▼──┐  ┌──▼──────────┐
                  │   /login   │  │   /signup   │
                  └──────┬─────┘  └──────┬──────┘
                         │ creds ok      │ org created
                         └────────┬──────┘
                                  │
                  ┌───────────────▼───────────────┐
                  │   requireSession() resolves   │
                  │         user + org            │
                  └───────────────┬───────────────┘
                                  │
                ┌─────────────────┼─────────────────┐
                │                 │                 │
        ┌───────▼────────┐ ┌──────▼──────┐ ┌────────▼────────┐
        │   /dashboard   │ │   /leads    │ │   /reminders    │
        └───────┬────────┘ └──────┬──────┘ └────────┬────────┘
                │                 │                 │
                │     opens       │      schedules  │
                │  WhatsAppDialog │  ReminderDialog │
                │     ▼           │       ▼         │
                │  wa.me/<n>?     │   Sonner toast  │
                │  text=<msg>     │   + revalidate  │
                │  (new tab)      │                 │
                └─────────────────┴─────────────────┘

  Topbar bell (NotificationsBell) ──▶ popover of pending reminders
                                      shown on every (app) route
```

Edge cases:

- **Authed visitor hits `/`, `/login`, or `/signup`** → server-side redirect to `/dashboard`.
- **Authed visitor with no org hits any `(app)` route** → `requireSession()` redirects to `/onboarding`.
- **Unauthed visitor hits any `(app)` route** → `requireSession()` redirects to `/login`.

---

## Layouts & Route Groups

| Layout | File | Wraps | Adds |
| --- | --- | --- | --- |
| Root | [src/app/layout.tsx](../src/app/layout.tsx) | Everything | `<html>`/`<body>`, Inter + Geist Mono, the pre-paint theme script in `<head>` (see [src/lib/theme.ts](../src/lib/theme.ts) — it must stay in a Server Component to run before first paint), our own `ThemeProvider` (not `next-themes`), Sonner `<Toaster>` |
| App shell | [src/app/(app)/layout.tsx](../src/app/(app)/layout.tsx) | Every `(app)` page | `requireSession()` gate; fetches the unique-lead count for the sidebar badge; `<AppShellProvider>` + `<AppShellGrid>` (260px or a 4rem rail, persisted in `localStorage`), `<SidebarNav>` + `<Topbar>` (mobile nav, breadcrumbs, palette, notifications); `<main>` scroll container. |
| Admin shell | [src/app/(admin)/layout.tsx](../src/app/(admin)/layout.tsx) | Every `(admin)/admin/**` page | `requireAdmin()` gate; own `<AdminSidebar>` (no customer-app chrome); admins without an organisation are still allowed through. |

Auth pages (`/login`, `/signup`, `/onboarding`) intentionally do **not** sit under `(app)` — they need a clean full-bleed layout, no sidebar, no topbar.

---

## Shared App Components

These render across multiple routes inside `(app)`. Consult the file directly for prop shapes — listed here so future contributors know where the abstraction lives.

| Component | File | Used by |
| --- | --- | --- |
| `Logo` | [src/components/brand/logo.tsx](../src/components/brand/logo.tsx) | Landing header, auth pages, sidebar |
| `SidebarNav` / `SidebarNavBody` | [src/components/app/sidebar-nav.tsx](../src/components/app/sidebar-nav.tsx) | App layout — sections + lead-count badge, driven by [src/lib/nav.ts](../src/lib/nav.ts). Collapses to a 4rem **icon rail** with tooltips, not to nothing. `SidebarNavBody` is shared with `MobileNav`. |
| `MobileNav` | [src/components/app/mobile-nav.tsx](../src/components/app/mobile-nav.tsx) | Topbar, below `md` — a left `Sheet` drawer. The `<aside>` is `hidden md:flex`, so this is the *only* navigation on a phone. |
| `Topbar` | [src/components/app/topbar.tsx](../src/components/app/topbar.tsx) | App layout — mobile nav trigger, sidebar toggle, `Breadcrumbs`, `CommandPalette`, bell, user menu |
| `Breadcrumbs` | [src/components/app/breadcrumbs.tsx](../src/components/app/breadcrumbs.tsx) | Topbar — nav-derived trail; renders **only at 2+ crumbs**, since one crumb only repeats the page `<h1>` |
| `CommandPalette` | [src/components/app/command-palette.tsx](../src/components/app/command-palette.tsx) | Topbar — Cmd/Ctrl+K. Nav jump + debounced lead search (`listLeads`) + theme. Replaced a search `<Input>` that had no handler and no results. |
| `NotificationsBell` | [src/components/app/notifications-bell.tsx](../src/components/app/notifications-bell.tsx) | Topbar — popover of pending reminders, inline mark-done |
| `UserMenu` | [src/components/app/user-menu.tsx](../src/components/app/user-menu.tsx) | Topbar — avatar dropdown, **theme radio (Light / Dark / System)**, logout |
| `EntityAvatar` | [src/components/app/entity-avatar.tsx](../src/components/app/entity-avatar.tsx) | Leads table, lead sheet, `/pulse` — initials on a tone hashed from the name, so a person is the same colour on every surface |
| `NavTabs` | [src/components/app/nav-tabs.tsx](../src/components/app/nav-tabs.tsx) | `/leads`, `/reminders`, campaign detail — `<Link>`-based underline tabs for URL-switching views, which keeps middle-click working |
| `DataTableCard` / `DataTableToolbar` / `DataTableHead` | [src/components/app/data-table.tsx](../src/components/app/data-table.tsx) | Every `<table>` in the app — shared chrome only; columns, sorting and rows stay with each table |
| `SectionLabel` | [src/components/app/section-label.tsx](../src/components/app/section-label.tsx) | ~34 sites — the one uppercase micro-label |
| `ErrorCard` | [src/components/app/error-card.tsx](../src/components/app/error-card.tsx) | 23 sites — built on `Alert` for the `role="alert"`, because it renders *instead of* what the user asked for |
| `DetailSheetShell` + primitives | [src/components/app/detail-sheet/](../src/components/app/detail-sheet/) | Lead sheet, cart sheet, COD sheet, recovery call sheet — pinned header, per-tab scrolling, `DescriptionList` (labels left, values right), `DetailPanel`, `DetailTimeline` |
| `CallSplitView` / `CallDetailPane` | [src/components/app/call-detail/](../src/components/app/call-detail/) | Lead sheet, cart sheet, COD sheet, recovery call sheet — the call list rail + full call detail. Typed structurally (`CallPaneCall`) so `Call`, `RecoveryCallRow` and `CodCallRow` all fit with no adapter. A hosting panel must be `<DetailSheetPanel fill>`. |
| `CodConfirmationDetail` | [src/components/app/cod-confirmation-detail.tsx](../src/components/app/cod-confirmation-detail.tsx) | `/campaigns/templates/cod-confirmation` — order summary, lifecycle timeline and confirmation-call rail. New: the section previously had no detail view, so its calls were invisible. |
| `StatCard` | [src/components/app/stat-card.tsx](../src/components/app/stat-card.tsx) | Analytics dashboard, `/leads` — icon + label + value + "vs. previous period" trend |
| `LeadsActivityTable` | [src/components/app/leads-activity-table.tsx](../src/components/app/leads-activity-table.tsx) | `/leads` — true `<table>`, one row per unique phone, with per-lead call counts. Middle columns are **catalog-driven** from `lead_field_definitions`, and the filter and sort controls are built from the same catalog. **Drag-resizable columns** persisted in `localStorage`. Realtime via `useLeadsRealtime`. Replaced `leads-table.tsx` + `leads-filter-bar.tsx`, neither of which exists any more. |
| `LeadCreateDialog` | [src/components/app/lead-create-dialog.tsx](../src/components/app/lead-create-dialog.tsx) | `/leads`, `/pulse` — captures name/phone/product/intent/status/city/pincode/notes; `source` stamped as `manual` implicitly |
| `LeadExportDialog` | [src/components/app/lead-export-dialog.tsx](../src/components/app/lead-export-dialog.tsx) | `/leads` header — duration picker + CSV download |
| `LeadDetailSheet` | [src/components/app/lead-detail-sheet.tsx](../src/components/app/lead-detail-sheet.tsx) | `/leads` — tabbed **Summary / Calls / Activity** on `DetailSheetShell`, fixed `lg` width. Reads + edits lead fields including `actionable` and `recording_url`. Deep-links a call via `?call=<id>` written with raw `history.replaceState` — **never `router.replace`**, which would re-run the leads server component and unmount the sheet mid-click. **One** edit mode for the whole Summary panel — Edit in the pinned header, a single sticky Save/Cancel, one `updateLead` call carrying the row fields and both JSONB patches. Delete lives in the header overflow menu; there is no footer. Pure helpers live in [src/lib/leads/](../src/lib/leads/). |
| `ConversationsTable` | [src/components/app/conversations-table.tsx](../src/components/app/conversations-table.tsx) | `/conversations` + campaign **Calls** tab — `<table>` of `CallWithLead` rows with direction badge, status badge, **Disposition** column (`call_outcome` + `requested_callback_at`), **Best disposition** column (`best_outcome` — contact's best across attempts; campaign Calls tab only), **Audio → Play** for `recording_url`, transcript fallback. Realtime via `useCallsRealtime`. |
| `ConversationsFilterBar` | [src/components/app/conversations-filter-bar.tsx](../src/components/app/conversations-filter-bar.tsx) | `/conversations` — Range (24h / 7d / 30d / all) · Agent · Outcome · Direction · debounced phone/ID search. URL-driven via search params. |
| `CampaignCallsFilterBar` | [src/components/app/campaign-calls-filter-bar.tsx](../src/components/app/campaign-calls-filter-bar.tsx) | Campaign detail **Calls** tab — Status · Call outcome (from `listCampaignOutcomeOptions`) · debounced number/ID search. URL-driven, always preserves `tab=calls`. |
| `CallTranscriptDialog` | [src/components/app/call-transcript-dialog.tsx](../src/components/app/call-transcript-dialog.tsx) | Lead detail sheet, conversations table — chat-bubble render of parsed transcript turns, with raw-blob fallback |
| `RemindersList` | [src/components/app/reminders-list.tsx](../src/components/app/reminders-list.tsx) | `/reminders` |
| `ReminderDialog` | [src/components/app/reminder-dialog.tsx](../src/components/app/reminder-dialog.tsx) | `/pulse`, `/leads` (per-row), `/reminders`, NotificationsBell |
| `WhatsAppDialog` | [src/components/app/whatsapp-dialog.tsx](../src/components/app/whatsapp-dialog.tsx) | `/leads` (per-row) |
| `LockedCard` | [src/components/app/locked-card.tsx](../src/components/app/locked-card.tsx) | `/developer`, `/billing` — shared "Access denied" / "Coming soon" placeholder |
| `CampaignsTable` | [src/components/app/campaigns-table.tsx](../src/components/app/campaigns-table.tsx) | `/campaigns` — `<table>` of `CampaignListItem` rows with status badge, **Best disposition** column (`best_disposition` — campaign's best across all contacts), segmented progress bar (succeeded · in-flight · failed), and per-row actions (Run Now, Stop, Download results CSV, Delete). Realtime via `useCampaignsRealtime`. |
| `CampaignUploadDialog` | [src/components/app/campaign-upload-dialog.tsx](../src/components/app/campaign-upload-dialog.tsx) | `/campaigns` header — name, **drag-and-drop CSV** (or click-to-browse) with inline phone-column detection and `valid / total` count, run-now vs schedule (datetime), retry slider 0–9, retry interval Select (5 min → 24 hr), retry-on checkboxes (no_answer / busy / failed / canceled), caller-ID number pool, and caller-ID switching (connect-rate floor % + window). Submits via `createCampaign`. |
| `VoiceAgentStatusCard` | [src/components/app/voice-agent-status-card.tsx](../src/components/app/voice-agent-status-card.tsx) | `/settings` — **read-only** view of the org's voice agent provisioned by an admin |
| `VoiceAgentBanner` | [src/components/app/voice-agent-banner.tsx](../src/components/app/voice-agent-banner.tsx) | `/dashboard`, `/pulse` — "awaiting provisioning" if no integration, celebration banner for 7 days after connection |

### Admin components

| Component | File | Used by |
| --- | --- | --- |
| `AdminSidebar` | [src/components/admin/admin-sidebar.tsx](../src/components/admin/admin-sidebar.tsx) | `(admin)/` layout |
| `OrgInfoForm` | [src/components/admin/org-info-form.tsx](../src/components/admin/org-info-form.tsx) | `/admin/organisations/[id]` — edit name/slug; slug unlocks behind an explicit confirm |
| `VoiceAgentForm` | [src/components/admin/voice-agent-form.tsx](../src/components/admin/voice-agent-form.tsx) | `/admin/organisations/[id]` — connect / update / disconnect the per-org voice agent |
| `OutcomePoliciesEditor` | [src/components/admin/outcome-policies-editor.tsx](../src/components/admin/outcome-policies-editor.tsx) | `/admin/organisations/[id]/outcomes` — add/edit/remove call outcomes, set action + counts-as-success, copy keys for the agent, **click-to-rank priority** ordering (`reorderOutcomePolicies`; top 5 = Best disposition window) |
| `UserRowActions` | [src/components/admin/user-row-actions.tsx](../src/components/admin/user-row-actions.tsx) | `/admin/users` — promote / demote button per row |

### Analytics components

| Component | File | Used by |
| --- | --- | --- |
| `RangeToggle` | [src/components/app/analytics/range-toggle.tsx](../src/components/app/analytics/range-toggle.tsx) | Dashboard — URL-driven 24h/7d/14d/30d selector |
| `ChartFrame` | [src/components/app/analytics/chart-frame.tsx](../src/components/app/analytics/chart-frame.tsx) | Dashboard — shared card shell with icon + title + subtitle |
| `DailyBarChart` | [src/components/app/analytics/daily-bar-chart.tsx](../src/components/app/analytics/daily-bar-chart.tsx) | Dashboard — flexbox-based daily bar chart |
| `StackedBarChart` | [src/components/app/analytics/stacked-bar-chart.tsx](../src/components/app/analytics/stacked-bar-chart.tsx) | Dashboard — Hot/Warm/Cold stacked per day |
| `HorizontalBarList` | [src/components/app/analytics/horizontal-bar-list.tsx](../src/components/app/analytics/horizontal-bar-list.tsx) | Dashboard — Product Interest ranking |
| `CallOutcomes` | [src/components/app/analytics/call-outcomes.tsx](../src/components/app/analytics/call-outcomes.tsx) | Dashboard — segmented bar + legend for call statuses |

| `PieChart` | [src/components/app/analytics/pie-chart.tsx](../src/components/app/analytics/pie-chart.tsx) | Admin dashboard widgets — SVG donut, up to 8 slices then an "Other" wedge |
| `LineChart` | [src/components/app/analytics/line-chart.tsx](../src/components/app/analytics/line-chart.tsx) | Admin dashboard widgets — SVG line + area, resize-observed |
| `PivotTable` | [src/components/app/analytics/pivot-table.tsx](../src/components/app/analytics/pivot-table.tsx) | Admin dashboard widgets |

Analytics data is computed in [src/lib/analytics/dashboard.ts](../src/lib/analytics/dashboard.ts) (server-only). All charts are plain CSS + SVG + Tailwind — no chart library is bundled.

**Two palettes, and the split is deliberate.** Categorical series (a breakdown by agent, by product, by city) read from `--chart-1..8` via [src/lib/charts.ts](../src/lib/charts.ts). Status series do **not**: in `call-outcomes.tsx` a failed call is `destructive` and a completed one is `success`, because there the colour carries the meaning. See [ui-refresh.md](ui-refresh.md).

The two action dialogs are designed to be triggered from any surface that has a `lead` (WhatsApp) or an `organisationId` (reminder), so the same UX appears whether you launch them from the table, the bell, or a stat card.

### Form components

| Component | File | Used by |
| --- | --- | --- |
| `LoginForm` | [src/components/forms/login-form.tsx](../src/components/forms/login-form.tsx) | `/login` |
| `SignupForm` | [src/components/forms/signup-form.tsx](../src/components/forms/signup-form.tsx) | `/signup` |

### Realtime client hooks

These subscribe to Supabase Postgres CHANGES so `(app)` pages auto-refresh when DB rows change. Both debounce events by 350 ms and call `router.refresh()` — server-side filter/sort/paging stay authoritative. See [api.md § Realtime](api.md#realtime).

| Hook | File | Subscribed to | Used by |
| --- | --- | --- | --- |
| `useLeadsRealtime(orgSlug)` | [src/hooks/use-leads-realtime.ts](../src/hooks/use-leads-realtime.ts) | `public.leads` filtered by `org_slug=eq.<slug>` | `LeadsActivityTable` |
| `useCallsRealtime(orgId)` | [src/hooks/use-calls-realtime.ts](../src/hooks/use-calls-realtime.ts) | `public.calls` filtered by `organisation_id=eq.<id>` | `ConversationsTable` |
| `useCampaignsRealtime(orgId)` | [src/hooks/use-campaigns-realtime.ts](../src/hooks/use-campaigns-realtime.ts) | `public.campaigns` + `public.campaign_contacts` filtered by `organisation_id=eq.<id>` | `CampaignsTable` |
| `useClientNow()` | [src/hooks/use-client-now.ts](../src/hooks/use-client-now.ts) | (no subscription) | Pages that render relative timestamps — gives a hydration-safe `Date.now()` ticker. |

---

## Auth Gating Rules

All gating is server-side — there is no client-side route guard. Four primitives:

1. **`getCurrentUser()`** — [src/actions/auth.ts](../src/actions/auth.ts). Returns the Supabase `User` or `null`. Used by `/`, `/login`, `/signup` to redirect signed-in visitors away.
2. **`requireSession()`** — [src/lib/auth/session.ts](../src/lib/auth/session.ts). Returns `{ userId, email, organisation }` or redirects:
   - No user → `/login`
   - User has no org → `/onboarding`
   This is the single gate for every `(app)` page.
3. **`requireAdmin()`** / **`getIsAdmin()`** — [src/lib/auth/admin.ts](../src/lib/auth/admin.ts). The hard gate (redirects non-admins to `/dashboard`) and a non-redirecting read for conditional UI. Platform admins are Skelo staff — they may not belong to any organisation.
4. **`updateSession()`** — [src/lib/supabase/middleware.ts](../src/lib/supabase/middleware.ts), wired in [src/middleware.ts](../src/middleware.ts). Refreshes the Supabase session cookie on every non-asset request. Does not block — just keeps the session alive.

### Landing logic

- `login` Server Action picks the destination itself and returns `{ redirectTo }`:
  - admin → `/admin`
  - has org → `/dashboard`
  - no org → `/onboarding`
- `/login`, `/signup`, and `/onboarding` all bounce authed admins straight to `/admin` so they never see customer chrome.
- Every admin Server Action calls `requireAdmin()` at the top — defense in depth, not just a layout gate.

Server Actions enforce their own auth + multi-tenancy independently of the route layer (see [api.md § Security Model](api.md#security-model)).

---

## When to Update This Doc

Add a row to **Route Reference** when you create a new `page.tsx` under `src/app/`. Add a row to **Shared App Components** when you create a component under `src/components/app/` that more than one page consumes. Update the **Navigation Flow** ASCII when the redirect rules change.

When adding a route that is gated beyond `requireSession()` (roles, plan tier), reuse `LockedCard` so every denied page has a consistent "Access denied" / "Coming soon" treatment — see the Outreach and System placeholder routes.
