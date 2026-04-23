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
├── /signup                 → Create workspace
├── /onboarding             → Org bootstrap (rare fallback)
├── /api/webhooks/bolna/*   → External webhooks (no UI)
│
└── (app)/                  → Authenticated shell — sidebar + topbar
    ├── /dashboard          → Org overview
    ├── /leads              → Lead CRM table
    ├── /reminders          → Reminder list (?status=pending|done|dismissed)
    └── /settings           → Workspace + account
```

`(app)` is a Next.js [route group](https://nextjs.org/docs/app/getting-started/layouts-and-pages) — the parentheses do not appear in the URL. Everything inside it shares the dashboard chrome and is gated by `requireSession()`.

---

## Route Reference

| URL | File | Auth | Purpose |
| --- | --- | --- | --- |
| `/` | [src/app/page.tsx](../src/app/page.tsx) | Public · redirects to `/dashboard` if signed in | Marketing landing — hero, features, dashboard preview, CTA |
| `/login` | [src/app/login/page.tsx](../src/app/login/page.tsx) | Public · redirects to `/dashboard` if signed in | Email + password sign in |
| `/signup` | [src/app/signup/page.tsx](../src/app/signup/page.tsx) | Public · redirects to `/dashboard` if signed in | Email + password + workspace name; creates org via `signUp()` |
| `/onboarding` | [src/app/onboarding/page.tsx](../src/app/onboarding/page.tsx) | Authed · redirects to `/dashboard` if user has any org | Fallback when an authed user has no org (e.g. org was deleted) |
| `/dashboard` | [src/app/(app)/dashboard/page.tsx](../src/app/(app)/dashboard/page.tsx) | Authed + org required | Greeting, 4 stat cards, recent leads, upcoming reminders |
| `/leads` | [src/app/(app)/leads/page.tsx](../src/app/(app)/leads/page.tsx) | Authed + org required | Full leads table with WhatsApp + reminder actions per row |
| `/reminders` | [src/app/(app)/reminders/page.tsx](../src/app/(app)/reminders/page.tsx) | Authed + org required | Tabbed reminder list. Query: `?status=pending\|done\|dismissed` (default `pending`) |
| `/settings` | [src/app/(app)/settings/page.tsx](../src/app/(app)/settings/page.tsx) | Authed + org required | Workspace + account view (read-only stub) |
| `POST /api/webhooks/bolna/leads` | [src/app/api/webhooks/bolna/leads/route.ts](../src/app/api/webhooks/bolna/leads/route.ts) | Signed (header `x-bolna-signature`) | Inbound lead capture — see [api.md](api.md#bolna-webhook) |

> Routes not listed here do not exist. The middleware refreshes the Supabase session on every request but does **not** itself enforce route guards — guarding lives inside `requireSession()` and the auth pages' redirect checks.

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
| App shell | [src/app/(app)/layout.tsx](../src/app/(app)/layout.tsx) | `/dashboard`, `/leads`, `/reminders`, `/settings` | `requireSession()` gate, `<SidebarNav>`, `<Topbar>` (with notifications), `<main>` scroll container |

Auth pages (`/login`, `/signup`, `/onboarding`) intentionally do **not** sit under `(app)` — they need a clean full-bleed layout, no sidebar, no topbar.

---

## Shared App Components

These render across multiple routes inside `(app)`. Consult the file directly for prop shapes — listed here so future contributors know where the abstraction lives.

| Component | File | Used by |
| --- | --- | --- |
| `Logo` | [src/components/brand/logo.tsx](../src/components/brand/logo.tsx) | Landing header, auth pages, sidebar |
| `SidebarNav` | [src/components/app/sidebar-nav.tsx](../src/components/app/sidebar-nav.tsx) | App layout |
| `Topbar` | [src/components/app/topbar.tsx](../src/components/app/topbar.tsx) | App layout |
| `NotificationsBell` | [src/components/app/notifications-bell.tsx](../src/components/app/notifications-bell.tsx) | Topbar — popover of pending reminders, inline mark-done |
| `UserMenu` | [src/components/app/user-menu.tsx](../src/components/app/user-menu.tsx) | Topbar — avatar dropdown, logout |
| `StatCard` | [src/components/app/stat-card.tsx](../src/components/app/stat-card.tsx) | Dashboard |
| `LeadsTable` | [src/components/app/leads-table.tsx](../src/components/app/leads-table.tsx) | `/leads` |
| `LeadCreateDialog` | [src/components/app/lead-create-dialog.tsx](../src/components/app/lead-create-dialog.tsx) | Dashboard, `/leads` |
| `RemindersList` | [src/components/app/reminders-list.tsx](../src/components/app/reminders-list.tsx) | `/reminders` |
| `ReminderDialog` | [src/components/app/reminder-dialog.tsx](../src/components/app/reminder-dialog.tsx) | Dashboard, `/leads` (per-row), `/reminders`, NotificationsBell |
| `WhatsAppDialog` | [src/components/app/whatsapp-dialog.tsx](../src/components/app/whatsapp-dialog.tsx) | `/leads` (per-row) |

The two action dialogs are designed to be triggered from any surface that has a `lead` (WhatsApp) or an `organisationId` (reminder), so the same UX appears whether you launch them from the table, the bell, or a stat card.

### Form components

| Component | File | Used by |
| --- | --- | --- |
| `LoginForm` | [src/components/forms/login-form.tsx](../src/components/forms/login-form.tsx) | `/login` |
| `SignupForm` | [src/components/forms/signup-form.tsx](../src/components/forms/signup-form.tsx) | `/signup` |

---

## Auth Gating Rules

All gating is server-side — there is no client-side route guard. Three primitives:

1. **`getCurrentUser()`** — [src/actions/auth.ts](../src/actions/auth.ts). Returns the Supabase `User` or `null`. Used by `/`, `/login`, `/signup` to redirect signed-in visitors away.
2. **`requireSession()`** — [src/lib/auth/session.ts](../src/lib/auth/session.ts). Returns `{ userId, email, organisation }` or redirects:
   - No user → `/login`
   - User has no org → `/onboarding`
   This is the single gate for every `(app)` page.
3. **`updateSession()`** — [src/lib/supabase/middleware.ts](../src/lib/supabase/middleware.ts), wired in [src/middleware.ts](../src/middleware.ts). Refreshes the Supabase session cookie on every non-asset request. Does not block — just keeps the session alive.

Server Actions enforce their own auth + multi-tenancy independently of the route layer (see [api.md § Security Model](api.md#security-model)).

---

## When to Update This Doc

Add a row to **Route Reference** when you create a new `page.tsx` under `src/app/`. Add a row to **Shared App Components** when you create a component under `src/components/app/` that more than one page consumes. Update the **Navigation Flow** ASCII when the redirect rules change.
