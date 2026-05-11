# UAT Environment Setup & Promotion Guide

This guide covers spinning up `uat.skelo.team` against a **separate Supabase project** from prod (`app.skelo.team`), and the recurring checklist for safely promoting changes from `uat` → `main`.

> **Why a separate Supabase project for UAT?**
> Sharing one DB across environments looks cheap, but it breaks the things UAT exists to validate: schema migrations have no rehearsal, `pg_cron` + Vault secrets can only point at one environment, and each Bolna agent's post-call webhook URL fires at exactly one app. The free Supabase tier handles a small UAT workspace fine — keep prod clean.

---

## Table of Contents

1. [Architecture at a glance](#architecture-at-a-glance)
2. [One-time UAT setup](#one-time-uat-setup)
3. [`.env` matrix](#env-matrix)
4. [Migration strategy](#migration-strategy)
5. [Recurring `uat` → `main` checklist](#recurring-uat--main-checklist)
6. [Things that don't transfer](#things-that-dont-transfer)
7. [Smoke test on prod after deploy](#smoke-test-on-prod-after-deploy)
8. [Common gotchas](#common-gotchas)

---

## Architecture at a glance

| Layer | UAT | Prod |
| --- | --- | --- |
| Domain | `uat.skelo.team` | `app.skelo.team` |
| Git branch | `uat` | `main` (or `master`) |
| Azure deploy | UAT App Service / slot | Prod App Service / slot |
| Supabase project | UAT project | Prod project |
| Bolna agent(s) | Separate test agent(s) | Production agents |
| Cron tick (`pg_cron`) | Tick → `https://uat.skelo.team/api/cron/campaigns/tick` | Tick → `https://app.skelo.team/api/cron/campaigns/tick` |

Everything in this guide flows from the rule that **secrets and integration endpoints are env-local**. Code promotes; secrets do not.

---

## One-time UAT setup

### Supabase project

1. Create a second Supabase project for UAT.
2. **Database → Extensions:** enable `pg_cron` and `pg_net`. (Vault is on by default.)
3. **Auth → URL Configuration:** add `https://uat.skelo.team` to *Site URL* and *Additional Redirect URLs*. Without this, magic-link / email-confirm callbacks bounce.
4. **Apply migrations** (in chronological order — there are only three after the cleanup):
   ```bash
   npx supabase link --project-ref <UAT_PROJECT_REF>
   npx supabase db push
   ```
   Or paste each `supabase/migrations/*.sql` file into the SQL editor in order.

5. **Create Vault secrets** with the names the cron function reads, but **UAT-pointed values**:
   ```sql
   select vault.create_secret(
     'https://uat.skelo.team/api/cron/campaigns/tick',
     'campaigns_cron_target_url'
   );
   select vault.create_secret(
     '<a-long-random-string-only-UAT-knows>',
     'campaigns_cron_secret'
   );
   ```

6. **Bootstrap the first admin** in the UAT DB:
   ```sql
   update public.profiles set is_admin = true
   where id = (select id from auth.users where email = 'you@example.com');
   ```
   Sign out + back in to land on `/admin`.

### Bolna

7. Create a **separate Bolna agent** for UAT (or a test agent in your existing workspace).
8. Configure that agent's **Post-call webhook URL** to:
   ```
   https://uat.skelo.team/api/webhooks/bolna/leads?secret=<UAT_BOLNA_WEBHOOK_SECRET>
   ```
   Do **not** point a single Bolna agent at both envs — webhooks would race and lead/call rows would land in the wrong DB.
9. After login on UAT, set up the org's `bolna_integrations` row from **Settings → Voice agent integration** with the UAT agent's `agent_id` and `api_key`.

### Azure

10. A second App Service / Container App for UAT (or a deployment slot pointed at the `uat` branch). Each environment has its own env-var bundle (see matrix below).
11. DNS / custom domain: `uat.skelo.team` → UAT deploy, `app.skelo.team` → prod deploy.
12. Wire your CI to deploy:
    - `uat` branch → UAT App Service
    - `main` (or `master`) branch → Prod App Service

---

## `.env` matrix

Every secret in this table should be a **different value across UAT and prod**. Sharing any of them defeats the isolation you set UAT up for.

| Variable | UAT value | Prod value |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | UAT project URL | Prod project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | UAT anon key | Prod anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | UAT service-role key | Prod service-role key — **never** share or check in |
| `BOLNA_WEBHOOK_SECRET` | UAT-only random string | Prod-only random string |
| `BOLNA_API_BASE_URL` | `https://api.bolna.ai` | same |
| `CRON_SECRET` | Same string as UAT Vault's `campaigns_cron_secret` | Same string as Prod Vault's `campaigns_cron_secret` |

**Generating random secrets:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use a fresh value for each secret in each environment. Don't reuse one string across slots.

---

## Migration strategy

After the cleanup, `supabase/migrations/` contains exactly three files:

| File | Purpose |
| --- | --- |
| `20260507000000_baseline_schema.sql` | Consolidated schema through 2026-05-05 — every table, enum, RLS policy, trigger, index, and RPC needed before campaigns. **Idempotent** — `IF NOT EXISTS` on every CREATE, drop-then-recreate on every policy. Safe to re-apply. |
| `20260508000000_campaigns.sql` | Campaigns + campaign_contacts tables, the `calls.campaign_contact_id` FK, RLS, the counter trigger, and the realtime publication entries. |
| `20260508000001_campaigns_cron.sql` | `pg_cron` + `pg_net` extensions, the `campaigns_cron_tick()` function, and the every-minute schedule. **Apply only after** the two extensions are enabled in the dashboard. |

**Rule:** every new schema change goes in a **new timestamped file** under `supabase/migrations/`. Never edit baseline_schema.sql or the existing campaigns migrations after a release. Append, don't mutate.

---

## Recurring `uat` → `main` checklist

Run through this every time you merge `uat` into `main`:

### 1. Migrations

- Diff the migrations directory: `git diff main..uat -- supabase/migrations/`.
- Apply any new files to **prod** in the same order they ran on UAT:
  ```bash
  npx supabase link --project-ref <PROD_PROJECT_REF>
  npx supabase db push
  ```
  Or paste them into the prod SQL editor in order.
- For migrations that depend on **extensions or Vault secrets** (e.g. anything cron-related), confirm prod has the extensions enabled and the named secrets created **before** running the migration. Otherwise the function silently no-ops.

### 2. Env vars

- Search the diff for any new `process.env.X` introduced on UAT:
  ```bash
  git diff main..uat -- 'src/**/*.ts' 'src/**/*.tsx' | grep -E "process\.env\."
  ```
- Add each new var to the **prod** Azure App Service config with a prod-appropriate value **before** the deploy goes out. Otherwise the prod app boots into broken state on first request.

### 3. Cron / Vault

- Cron schedule itself is created by migrations — usually nothing to change.
- If you **rotated `CRON_SECRET`** during UAT testing, mirror the rotation to prod **atomically**:
  ```sql
  -- in PROD SQL editor
  select id from vault.secrets where name = 'campaigns_cron_secret';
  select vault.update_secret('<id>', '<new prod secret>');
  ```
  Then update `CRON_SECRET` in the prod App Service config to the same value. Drift between Vault and env causes the cron tick to 401 silently.

### 4. Webhooks

- If you added any new webhook routes during UAT (e.g. a new Bolna event), make sure the **prod Bolna agents'** post-call URLs are still correct — they don't change automatically. Each prod agent's webhook URL must point to `https://app.skelo.team/api/webhooks/bolna/leads?secret=<PROD_BOLNA_WEBHOOK_SECRET>`.
- If you rotated `BOLNA_WEBHOOK_SECRET`, update the secret in **every prod Bolna agent's URL query string first**, then rotate the env var. (Webhook signature check fails otherwise — and Bolna doesn't retry after a 401.)

### 5. Realtime publication

- Tables added to `supabase_realtime` via `alter publication ... add table` get applied automatically when you run the migration.
- Sanity check after a release that touched it:
  ```sql
  select tablename from pg_publication_tables
  where pubname = 'supabase_realtime'
  order by 1;
  ```

### 6. Type & lint gates (local, before merge)

```bash
npx tsc --noEmit
npm run lint
```

---

## Things that don't transfer

These are environment-local and **don't promote** with code. Set them up once per environment:

- The contents of `bolna_integrations` (per-org, per-DB).
- The contents of `vault.secrets` (per-DB).
- Auth users / org rows (per-DB).
- The first-admin bootstrap (per-DB).
- DNS / Azure App Service config (per-env).
- Bolna agent webhook URLs (per-agent, configured in the Bolna dashboard).

---

## Smoke test on prod after deploy

After a `main` deploy lands, do this in 90 seconds:

1. Sign in with a real prod account.
2. Open `/leads` — table renders, infinite scroll works.
3. From `/leads`, click the phone icon on any lead with a number you control. A `calls` row should appear within a few seconds with `bolna_call_id` populated.
4. From `/campaigns`, upload a 1-row CSV (your own number). Within ~60 seconds, the contact should move `pending → in_flight`. (If it stays `pending` past two minutes, the cron tick isn't reaching the route — see *Common gotchas*.)
5. `curl -X POST https://app.skelo.team/api/cron/campaigns/tick` (no secret header) → should return `401`. Confirms the route is gated.

---

## Common gotchas

**Cron silently no-ops on UAT or prod.**
Either `pg_cron`/`pg_net` aren't enabled, or the Vault secrets `campaigns_cron_target_url` / `campaigns_cron_secret` don't exist in that DB, or `CRON_SECRET` in the env doesn't match `campaigns_cron_secret` in Vault. Check all three. The cron function returns nothing rather than erroring on missing config — by design — so failures are quiet.

**Bolna webhook calls land in the wrong env.**
A single Bolna agent has exactly one post-call webhook URL. If you point it at prod, UAT calls update prod data. Always create a separate Bolna agent (or at least a separate webhook URL) per env.

**Service-role key leaked to the browser.**
`SUPABASE_SERVICE_ROLE_KEY` must only ever be referenced in server code (Server Actions, route handlers, `src/lib/supabase/admin.ts`). If you grep for it in `src/components/` or anything `"use client"`, that's a P0 — rotate the key immediately.

**Realtime publication missing a new table.**
After a migration that adds a tenant-scoped table, if the `useXRealtime` hook on that table doesn't fire, check `pg_publication_tables` (query above). The fix is `alter publication supabase_realtime add table public.<table>;` — and adding it to the migration so the next env doesn't repeat the bug.

**`intent_type` enum mismatch.**
The original migration created the `intent_type` enum with capitalized values (`'Hot'`, `'Warm'`, `'Cold'`). The TypeScript expects lowercase. Prod was hand-aligned at some point; the consolidated baseline now uses lowercase. If you're applying the baseline to a DB that still has capitalized values, the TS will silently mismatch. One-shot fix:
```sql
alter type public.intent_type rename value 'Hot' to 'hot';
alter type public.intent_type rename value 'Warm' to 'warm';
alter type public.intent_type rename value 'Cold' to 'cold';
```

**Migration order matters.**
Always apply the migration files in **timestamp order**. The Supabase CLI does this for you; if you're pasting into the SQL editor, paste in filename order.
