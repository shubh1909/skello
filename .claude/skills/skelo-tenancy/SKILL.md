---
name: skelo-tenancy
description: Org resolution, multi-tenancy scoping, Supabase client selection, auth/session helpers, RLS policy conventions, and soft-delete filtering in Skelo. Load this for ANY task that reads or writes a tenant-scoped table, picks a Supabase client, touches auth/session/onboarding, writes an RLS policy or migration, or involves soft-delete. This is the highest-frequency skill — when in doubt, load it.
---

# Skelo Tenancy, Auth & Data Access

Verified against source. Where this contradicts `CLAUDE.md` or `backend-engineer-agent.md`, **this file is correct** — those files carry known errors (see "Corrections" below).

## 1. Spelling: British, always

The DB uses **`organisations`** / **`organisation_id`**. The American `organization_id` / `organizations` **does not exist anywhere in this codebase**. The only American-spelled token is `autoComplete="organization"`, an HTML attribute in `src/components/forms/signup-form.tsx`.

Writing `organization_id` fails. `CLAUDE.md` Law #1 and `backend-engineer-agent.md` both use the wrong spelling — ignore them on this point.

## 2. `leads` is dual-keyed — the most expensive trap in the repo

`leads` carries **both** `organisation_id` (uuid) and `org_slug` (text). This is a half-finished migration, not a design.

- **App-layer convention: filter by `organisation_id`.** `src/actions/leads.ts` scopes every query with `.eq("organisation_id", org.id)` (lines 134, 225, 281, 499, 509, 532, 547).
- **On insert, write BOTH** `organisation_id` and `org_slug` (`actions/leads.ts:359-360`). Omitting `org_slug` makes the row invisible to the slug-keyed RLS policy.
- `20260517000001_lead_call_remodel.sql:41` — "organisation_id becomes the FK tenancy gate; org_slug stays as a [denormalized convenience]".
- `20260517000003_cleanup.sql:77` — org_slug "keep as denormalized convenience for now".

**`leads` has TWO overlapping permissive RLS policy sets** (Postgres OR's them):

| Policy | Migration | Predicate |
|---|---|---|
| `leads_select_own_org` | `20260623000001:79` | `deleted_at is null AND org_slug in (...)` |
| `leads_select_own_org_by_id` | `20260517000003:90` | `organisation_id in (...)` — **no `deleted_at`** |

**Both policies are live and OR'd.** `20260721000000_leads_soft_delete_rls_fix.sql` added the missing `deleted_at is null` predicate to the `_by_id` SELECT policy — before that fix, soft-deleted leads stayed visible because the `_by_id` policy alone re-exposed them.

Still true regardless: **`createAdminClient()` bypasses RLS**, so service-role paths must filter `deleted_at is null` by hand. The fix was scoped to SELECT only — UPDATE deliberately still permits touching soft-deleted rows so restore works.

## 3. Every other tenant table uses `organisation_id uuid`

FK to `organisations.id`: `reminders`, `calls`, `call_transcripts`, `campaigns`, `campaign_contacts`, `voice_agents`, `bolna_integrations`, `lead_field_overrides`, `lead_field_definitions`, `org_dashboard_widgets`, `org_outcome_policies`, `scheduled_callbacks`, `shopify_integrations`, `shopify_recovery_settings`, `shopify_recovery_attempts`, `whatsapp_integrations`, `shopify_recovery_messages`.

**Four tables use `organisation_id` as the PRIMARY KEY** (one row per org) — `bolna_integrations`, `shopify_integrations`, `shopify_recovery_settings`, `whatsapp_integrations`. Use `upsert` with a conflict target; a plain `insert` throws.

## 4. A third name at the RPC boundary

Postgres functions take **`p_org_id uuid`** (and lead-activity RPCs also take `p_org_slug text`). Their result tuples return `organisation_id`. One lead query can touch all three names. **Read the function signature before calling an RPC** — don't infer it.

## 5. Supabase clients — four factories

| Import | Factory | Use when | RLS |
|---|---|---|---|
| `@/lib/supabase/client` | `createClient()` | Client Components | applies |
| `@/lib/supabase/server` | `async createClient()` | Server Components / Actions / authed routes | **applies** |
| `@/lib/supabase/admin` | `createAdminClient()` | webhooks, cron, dispatch, rate-limit RPC | **BYPASSED** |
| `@/lib/supabase/middleware` | `updateSession(req)` | cookie refresh only | n/a |

- **`createClient` is exported by BOTH `server.ts` and `client.ts`** — identical name, opposite context. A wrong import path fails silently. The server one is `async` (awaits `cookies()`); forgetting `await` yields a Promise and confusing errors.
- **`createAdminClient()` drops tenant isolation AND soft-delete filtering in one move**, because both live in RLS. Every service-role query needs manual `organisation_id`/`org_slug` scoping *and* `deleted_at is null`.
- Env: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (**not** `..._ANON_KEY`), `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## 6. Auth

- `src/lib/auth/session.ts:14` — `requireSession()`: `getUser()` → null redirects `/login`; loads org by `owner_id` ordered `created_at ASC limit 1`; no org → `/onboarding`. Returns `{ userId, email, organisation }`.
- `src/lib/auth/admin.ts:21` — `requireAdmin()` reads `profiles.is_admin`, redirects non-admins to `/dashboard` (deliberately not 403, to avoid enumeration). `getIsAdmin()` at :44 is the non-redirecting variant.
- **Middleware does NOT protect routes.** `src/lib/supabase/middleware.ts` only refreshes the session cookie. **Every page must call `requireSession()` / `requireAdmin()` itself.**

## 7. No members, no invites, no roles

There is **no** membership model. No `members` / `org_members` / `invites` table exists. Tenancy is strictly **single-owner** via `organisations.owner_id → auth.uid()`. Do not write code against a members table or an org-scoped role enum.

The only role is `profiles.is_admin` — platform staff, not org-scoped. It is self-escalation-proof (the UPDATE policy's `WITH CHECK` pins it to its stored value); bootstrapping the first admin needs a manual service-role UPDATE. `profiles` is auto-provisioned by the `handle_new_user()` trigger.

`requireSession()` silently picks the **oldest** org when a user owns several — there is no org-switching concept.

## 8. RLS conventions

All 21 tenant tables have RLS enabled. Both idioms wrap `auth.uid()` in a scalar subselect `(select auth.uid())` for planner caching. Follow that when writing new policies.

**RLS enabled with ZERO policies = service-role only** (deny-all to `authenticated`): `bolna_integrations`, `rate_limits`, `org_dashboard_widgets`, `shopify_integrations`, `whatsapp_integrations`. Querying these with the cookie client returns **`[]`, not an error** — a silent-failure trap. Use `createAdminClient()`.

Service-role-only RPCs (revoked from `anon, authenticated` by `20260528000000`): `resolve_org_by_agent`, `resolve_org_by_dialed_number`, `lead_locked_fields`.

## 9. Soft delete

`deleted_at`, `deleted_by`, `deletion_batch_id` exist on exactly **seven** tables (`20260623000001`): `campaigns`, `campaign_contacts`, `calls`, `call_transcripts`, `leads`, `scheduled_callbacks`, `reminders`. No others.

Visibility is enforced inside the RLS SELECT policies — **except on `leads`** (see the bug in §2). Any `createAdminClient()` path must filter `deleted_at is null` by hand.

The lead dedupe index is **partial** on `deleted_at is null`, so soft-deleting a lead **frees its phone slot**. Find-or-create MUST filter `deleted_at IS NULL` or it will match an invisible row.

## 10. `ActionResult` — the real shape

`src/types/action.ts` is a **discriminated union**, narrower than the `{success, data?, error?}` shape in `CLAUDE.md`:

```ts
type ActionResult<T> = { success: true; data: T } | { success: false; error: string };
```

Use the `ok()` / `fail()` helpers. You must narrow on `success` before touching `data`.

## Corrections to project instructions

`CLAUDE.md` and `backend-engineer-agent.md` contain three verified errors — do not follow them:

1. `organization_id` — wrong spelling, column does not exist. Use `organisation_id` (and `org_slug` on `leads`).
2. `services/bolna/` and `actions/calls/` — do not exist. Reality: `src/lib/bolna/` and flat `src/actions/calls.ts`.
3. The `ActionResult` shape — it is a discriminated union (§10).

## Checklist before shipping a query

- [ ] Scoped by `organisation_id` (or `org_slug` on `leads`)?
- [ ] Right client for the context? Service-role → manual scoping + `deleted_at is null`.
- [ ] Writing to `leads`? Set **both** `organisation_id` and `org_slug`.
- [ ] Reading `leads`? Filter `deleted_at is null` explicitly — RLS won't.
- [ ] Named columns in `.select()`, never `*`.
- [ ] Upsert (not insert) on the four org-PK config tables.
