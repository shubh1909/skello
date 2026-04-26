# Skello Sitemap

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
│   └── leads/export        → Authenticated CSV export (GET)
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
    │   ├── /dashboard      → Analytics (range-filtered KPIs, charts)
    │   └── /pulse          → Operator snapshot (needs-attention, recent)
    ├── Leads
    │   ├── /leads          → Lead CRM table + export
    │   └── /conversations  → Placeholder (Coming soon)
    ├── Outreach
    │   └── /campaigns      → Placeholder (Access denied)
    ├── System
    │   ├── /settings       → Workspace + voice agent integration
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
| `/pulse` | [src/app/(app)/pulse/page.tsx](../src/app/(app)/pulse/page.tsx) | Authed + org required | Operator snapshot — hot-but-uncontacted alert card, recent leads, upcoming reminders, recent calls |
| `/leads` | [src/app/(app)/leads/page.tsx](../src/app/(app)/leads/page.tsx) | Authed + org required | Leads table (tabular) + Export dialog + filter bar (Status, Intent, Source, Contacted, Wants WA) + 4 contextual stat cards |
| `/conversations` | [src/app/(app)/conversations/page.tsx](../src/app/(app)/conversations/page.tsx) | Authed + org required | Placeholder — unified call/WhatsApp threads coming later |
| `/campaigns` | [src/app/(app)/campaigns/page.tsx](../src/app/(app)/campaigns/page.tsx) | Authed + org required | Placeholder — plan-gated (Access denied) |
| `/reminders` | [src/app/(app)/reminders/page.tsx](../src/app/(app)/reminders/page.tsx) | Authed + org required | Tabbed reminder list. Query: `?status=pending\|done\|dismissed` (default `pending`). Not in sidebar — reached from dashboard widgets and the lead detail sheet. |
| `/settings` | [src/app/(app)/settings/page.tsx](../src/app/(app)/settings/page.tsx) | Authed + org required | Workspace + account view; includes the voice agent integration card |
| `/developer` | [src/app/(app)/developer/page.tsx](../src/app/(app)/developer/page.tsx) | Authed + org required | Placeholder — role-gated (Access denied) |
| `/billing` | [src/app/(app)/billing/page.tsx](../src/app/(app)/billing/page.tsx) | Authed + org required | Placeholder — owner-gated (Access denied) |
| `GET /api/leads/export` | [src/app/api/leads/export/route.ts](../src/app/api/leads/export/route.ts) | Session-authed | CSV download. Query: `?range=today\|yesterday\|last_week\|last_month\|all`. Scoped to the caller's org. |
| `POST /api/webhooks/bolna/leads` | [src/app/api/webhooks/bolna/leads/route.ts](../src/app/api/webhooks/bolna/leads/route.ts) | Signed (header `x-bolna-signature` or `?secret=`) | Inbound lead capture. Fires voice-agent enrichment via `after()` — phone + transcript + call row. See [api.md](api.md#voice-agent-webhooks). |
| `POST /api/webhooks/bolna/calls` | [src/app/api/webhooks/bolna/calls/route.ts](../src/app/api/webhooks/bolna/calls/route.ts) | Signed | Outbound call status updates. When status flips to `completed`, fires transcript enrichment via `after()`. |
| `/admin` | [src/app/(admin)/admin/page.tsx](../src/app/(admin)/admin/page.tsx) | **Admin required** (`requireAdmin()`) | Platform-admin overview — org counts, voice agent states, recent signups |
| `/admin/organisations` | [src/app/(admin)/admin/organisations/page.tsx](../src/app/(admin)/admin/organisations/page.tsx) | Admin required | Every workspace, searchable by name or slug |
| `/admin/organisations/[id]` | [src/app/(admin)/admin/organisations/[id]/page.tsx](../src/app/(admin)/admin/organisations/[id]/page.tsx) | Admin required | Edit org name/slug, provision / pause / disconnect the voice agent, view owner |
| `/admin/users` | [src/app/(admin)/admin/users/page.tsx](../src/app/(admin)/admin/users/page.tsx) | Admin required | List every user, promote / demote admin — self-demotion blocked |

> Routes not listed here do not exist. The middleware refreshes the Supabase session on every request but does **not** itself enforce route guards — guarding lives inside `requireSession()` and the auth pages' redirect checks.

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
| Root | [src/app/layout.tsx](../src/app/layout.tsx) | Everything | `<html>`/`<body>`, fonts, `ThemeProvider`, Sonner `<Toaster>` |
| App shell | [src/app/(app)/layout.tsx](../src/app/(app)/layout.tsx) | Every `(app)` page | `requireSession()` gate; fetches total lead count for the sidebar badge; `<SidebarNav>` + `<Topbar>` (with notifications); `<main>` scroll container. |
| Admin shell | [src/app/(admin)/layout.tsx](../src/app/(admin)/layout.tsx) | Every `(admin)/admin/**` page | `requireAdmin()` gate; own `<AdminSidebar>` (no customer-app chrome); admins without an organisation are still allowed through. |

Auth pages (`/login`, `/signup`, `/onboarding`) intentionally do **not** sit under `(app)` — they need a clean full-bleed layout, no sidebar, no topbar.

---

## Shared App Components

These render across multiple routes inside `(app)`. Consult the file directly for prop shapes — listed here so future contributors know where the abstraction lives.

| Component | File | Used by |
| --- | --- | --- |
| `Logo` | [src/components/brand/logo.tsx](../src/components/brand/logo.tsx) | Landing header, auth pages, sidebar |
| `SidebarNav` | [src/components/app/sidebar-nav.tsx](../src/components/app/sidebar-nav.tsx) | App layout — grouped sections + total-lead count badge |
| `Topbar` | [src/components/app/topbar.tsx](../src/components/app/topbar.tsx) | App layout |
| `NotificationsBell` | [src/components/app/notifications-bell.tsx](../src/components/app/notifications-bell.tsx) | Topbar — popover of pending reminders, inline mark-done |
| `UserMenu` | [src/components/app/user-menu.tsx](../src/components/app/user-menu.tsx) | Topbar — avatar dropdown, logout |
| `StatCard` | [src/components/app/stat-card.tsx](../src/components/app/stat-card.tsx) | Analytics dashboard, `/leads` — icon + label + value + "vs. previous period" trend |
| `LeadsTable` | [src/components/app/leads-table.tsx](../src/components/app/leads-table.tsx) | `/leads` — true `<table>` with status/intent/contacted badges |
| `LeadsFilterBar` | [src/components/app/leads-filter-bar.tsx](../src/components/app/leads-filter-bar.tsx) | `/leads` — labelled filter controls for Status, Intent, Source, Contacted, Wants WA |
| `LeadCreateDialog` | [src/components/app/lead-create-dialog.tsx](../src/components/app/lead-create-dialog.tsx) | `/leads`, `/pulse` — captures name/phone/product/intent/status/city/pincode/notes; `source` stamped as `manual` implicitly |
| `LeadExportDialog` | [src/components/app/lead-export-dialog.tsx](../src/components/app/lead-export-dialog.tsx) | `/leads` header — duration picker + CSV download |
| `LeadDetailSheet` | [src/components/app/lead-detail-sheet.tsx](../src/components/app/lead-detail-sheet.tsx) | `/leads` — read + edit all lead fields; renders Reminders + Call History with transcript access |
| `CallTranscriptDialog` | [src/components/app/call-transcript-dialog.tsx](../src/components/app/call-transcript-dialog.tsx) | Lead detail sheet — chat-bubble render of parsed transcript turns, with raw-blob fallback |
| `RemindersList` | [src/components/app/reminders-list.tsx](../src/components/app/reminders-list.tsx) | `/reminders` |
| `ReminderDialog` | [src/components/app/reminder-dialog.tsx](../src/components/app/reminder-dialog.tsx) | `/pulse`, `/leads` (per-row), `/reminders`, NotificationsBell |
| `WhatsAppDialog` | [src/components/app/whatsapp-dialog.tsx](../src/components/app/whatsapp-dialog.tsx) | `/leads` (per-row) |
| `LockedCard` | [src/components/app/locked-card.tsx](../src/components/app/locked-card.tsx) | `/campaigns`, `/developer`, `/billing`, `/conversations` — shared "Access denied" / "Coming soon" placeholder |
| `VoiceAgentStatusCard` | [src/components/app/voice-agent-status-card.tsx](../src/components/app/voice-agent-status-card.tsx) | `/settings` — **read-only** view of the org's voice agent provisioned by an admin |
| `VoiceAgentBanner` | [src/components/app/voice-agent-banner.tsx](../src/components/app/voice-agent-banner.tsx) | `/dashboard`, `/pulse` — "awaiting provisioning" if no integration, celebration banner for 7 days after connection |

### Admin components

| Component | File | Used by |
| --- | --- | --- |
| `AdminSidebar` | [src/components/admin/admin-sidebar.tsx](../src/components/admin/admin-sidebar.tsx) | `(admin)/` layout |
| `OrgInfoForm` | [src/components/admin/org-info-form.tsx](../src/components/admin/org-info-form.tsx) | `/admin/organisations/[id]` — edit name/slug; slug unlocks behind an explicit confirm |
| `VoiceAgentForm` | [src/components/admin/voice-agent-form.tsx](../src/components/admin/voice-agent-form.tsx) | `/admin/organisations/[id]` — connect / update / disconnect the per-org voice agent |
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

Analytics data is computed in [src/lib/analytics/dashboard.ts](../src/lib/analytics/dashboard.ts) (server-only). All charts are plain CSS + Tailwind — no chart library is bundled.

The two action dialogs are designed to be triggered from any surface that has a `lead` (WhatsApp) or an `organisationId` (reminder), so the same UX appears whether you launch them from the table, the bell, or a stat card.

### Form components

| Component | File | Used by |
| --- | --- | --- |
| `LoginForm` | [src/components/forms/login-form.tsx](../src/components/forms/login-form.tsx) | `/login` |
| `SignupForm` | [src/components/forms/signup-form.tsx](../src/components/forms/signup-form.tsx) | `/signup` |

---

## Auth Gating Rules

All gating is server-side — there is no client-side route guard. Four primitives:

1. **`getCurrentUser()`** — [src/actions/auth.ts](../src/actions/auth.ts). Returns the Supabase `User` or `null`. Used by `/`, `/login`, `/signup` to redirect signed-in visitors away.
2. **`requireSession()`** — [src/lib/auth/session.ts](../src/lib/auth/session.ts). Returns `{ userId, email, organisation }` or redirects:
   - No user → `/login`
   - User has no org → `/onboarding`
   This is the single gate for every `(app)` page.
3. **`requireAdmin()`** / **`getIsAdmin()`** — [src/lib/auth/admin.ts](../src/lib/auth/admin.ts). The hard gate (redirects non-admins to `/dashboard`) and a non-redirecting read for conditional UI. Platform admins are Skello staff — they may not belong to any organisation.
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
