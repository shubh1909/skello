---
name: skelo-platform
description: Skelo platform/infra conventions — deployment (pm2, no Vercel), the pg_cron tick, error reporting via logSkeloError and Sentry scrubbing, rate limiting, campaign dispatch internals, dashboard analytics vs configurable widgets, CSV import/export, Zod/time/phone conventions, and the testing setup. Load this for cron, observability, rate limits, campaign dispatch, analytics, CSV, or writing tests.
---

# Skelo Platform & Infrastructure

Load `skelo-tenancy` alongside for client selection and scoping.

## Deployment — NOT Vercel

**There is no `vercel.json`.** Deployment is a **self-hosted VM under pm2** (`ecosystem.config.js` — single fork instance, `next start -p 3000`, logs to `./logs/skelo-*.log`). Never invent Vercel cron entries or `maxDuration` config.

## Cron — exactly ONE route

`src/app/api/cron/campaigns/tick/route.ts` is the **only** file under `src/app/api/cron/`.

- **Scheduling lives in the database**, not repo config: `pg_cron` + `pg_net` fire an every-minute POST. The schedule and `campaigns_cron_tick()` come from `20260508001_campaigns_cron.sql`. Target URL and secret live in **Supabase Vault** as `campaigns_cron_target_url` and `campaigns_cron_secret`.
- **Auth:** header **`x-cron-secret`** compared to `CRON_SECRET` via hand-rolled `timingSafeEqual` (`:11-18`). Missing env → 401 (fails closed). Not `Authorization: Bearer`.
- **POST only.** `runtime = "nodejs"`, `dynamic = "force-dynamic"`.
- **Fan-out (`:35-41`):** one tick drains **four** subsystems via `Promise.allSettled` — campaigns, callbacks, Shopify recovery, WhatsApp recovery. 500 only if **all four** reject; partial failures return 200 with per-subsystem `{error}` keys. **Adding a drainer means wiring it here and extending the all-rejected check.**
- **Misconfiguration is silent by design** — the SQL function returns without erroring when Vault secrets are absent, and a `CRON_SECRET` mismatch 401s silently.

## Error reporting

Files: `src/instrumentation.ts`, `src/instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `src/lib/observability/sentry-shared.ts`, `scrub.ts`, `src/lib/errors.ts`.

- **There is no `sentry.client.config.ts`** — Next 16 puts it in `src/instrumentation-client.ts`. Server/edge DSN `SENTRY_DSN`; client `NEXT_PUBLIC_SENTRY_DSN`. No DSN → full no-op.
- **`console.error` IS the reporting channel on server/edge** — `captureConsoleIntegration({ levels: ["error"] })` auto-captures it (deliberate, because the codebase logs-and-swallows). **Do not add an explicit `Sentry.captureException` next to a `console.error` — you'll double-report.** Not enabled on the client.
- **Use `logSkeloError(tag, userMessage, ctx)`** (`errors.ts:65`), not `Sentry.captureException`. It wraps `console.error` in `Sentry.withScope`, tags `skelo.tag`/`skelo.org`, and **returns the string `"<userMessage> [SKELO:TAG]"` which is meant to go into `ActionResult.error` and be shown in the toast** so testers can grep it.
- `warnSkelo` (`:102`) — non-fatal; `console.warn` + a **breadcrumb**, not an issue.
- **Always pass the Supabase error as `ctx.cause`** — `extractCause` (`:121`) exists because Postgrest errors have non-enumerable props and `JSON.stringify` yields `{}`.
- `SkeloErrorTag` is a **closed union** (`errors.ts:28-46`) — a new domain means adding to it.
- **Scrubbing is two-layer and fails CLOSED** (`scrub.ts`): key-name regex blanks `phone|token|secret|email|customer_name|recording_url|checkout_url|...`; value regexes redact query strings, Bearer tokens, emails, E.164, bare Indian 10-digit mobiles. If scrubbing throws, `sentry-shared.ts:12-24` deletes `request/extra/contexts/breadcrumbs/user` rather than send. **`scrub.ts` is deliberately isomorphic — do not add `server-only` to it.**
- `sendDefaultPii: false`, `tracesSampleRate` defaults to `0`.

## Rate limiting — fails OPEN

`src/lib/rate-limit.ts`: thin wrapper over the Postgres RPC `check_rate_limit(p_key, p_window_seconds, p_max)`, **always via the admin/service-role client** (`:41`), `server-only`.

**Fails open on any RPC or unexpected error** (`:52`, `:70`), logging `console.warn`. A failed check does **not** block traffic.

- Key convention: `"<feature>:<scope>:<identifier>"`, e.g. `shopify-webhook:ip:<ip>`.
- Route handlers pair it with `tooManyRequestsResponse()`; Server Actions use `clientIpFromHeaders(await headers())` and return `fail(...)`.
- `clientIpFromHeaders` header preference is **Azure-first** (`x-azure-socketip`, `cf-connecting-ip`, `x-real-ip`, `x-azure-clientip`, `x-forwarded-for`) and mirrors `src/lib/bolna/ip-allowlist.ts` — **keep the two in sync**. Spoofable if the proxy appends rather than overwrites (documented caveat, `:79-83`).

## Campaign dispatch

`src/lib/campaigns/dispatch.ts` (733 lines) — the drainer, service-role, called from the cron tick and directly by `createCampaign`. Exports `dispatchDueCampaignContacts()` (:358), `reconcileStuckCampaigns()` (:111), `pooledMap()` (:76), `computeNumberHealth()` (:245), `pickHealthyNumber()` (:292).

- **Throughput constants: `BATCH_LIMIT = 250`, `PER_CAMPAIGN_LIMIT = 100`, `CONCURRENCY = 25`** (`:28-34`). `docs/sitemap.md` was corrected to match and now points at `dispatch.ts` as the live source — **always trust the code over any doc for these numbers.**
- `STUCK_IN_FLIGHT_MS = 30min` — a contact is claimed `in_flight` at dial time and released only by the result webhook; after 30 min it's force-failed so the campaign can complete.
- Spam avoidance is **connect-rate-based number rotation**, not a fixed daily cap. Caller-IDs below a connect-rate floor are rested; all-resting defers with backoff 30m→60m→120m (`MAX_HEALTH_BACKOFF_ROUNDS = 3`), then dials the least-bad number and flags the run "degraded".
- **Health counts only terminal statuses** (`RESOLVED_CALL_STATUSES`, `:63`) — counting in-flight dials would read a fresh burst as 0% and throttle everything.
- Calling-window logic is factored into `src/lib/campaigns/calling-window.ts` (tested).
- `src/actions/campaigns.ts` (1053 lines) is the user-facing surface; mutations end with `revalidatePath("/campaigns")`. Contact rendering caps at `CONTACT_LIST_CAP = 200`.

## Analytics — two independent systems, don't conflate

1. **`src/lib/analytics/dashboard.ts`** — the fixed executive dashboard. `getDashboardAnalytics()` (:97) pulls raw `leads` + `calls` with the **cookie-bound user client** and aggregates **in JS**, not SQL. Ranges are a closed set `"24h"|"7d"|"14d"|"30d"`, default `"14d"`. On query failure it **degrades to an empty set** via `warnSkelo("ANALYTICS", ...)` rather than throwing.
   - ⚠️ `lead_intent`/`interest` no longer exist on leads — intent is `current_intent`, interest is dug from `lead_data` JSONB (`:50-56`, `pickInterest`). See `skelo-leads`.
2. **`src/actions/dashboard-widgets.ts`** — the *configurable* widget system on `org_dashboard_widgets` + RPC `execute_dashboard_widget`. `executeWidget` **re-validates the stored config through `widgetConfigSchema` before executing** so a tampered row can't smuggle an unsupported source. Foreign widget ids collapse to "not found" rather than leaking cross-tenant existence.

## CSV import / export

- **`src/app/api/imports/calls/route.ts`** is the only import route. It's an **NDJSON streaming** endpoint (`application/x-ndjson`, `X-Accel-Buffering: no`), one JSON line per row so the progress bar ticks. Auth via `requireSession()`; **org id comes from the session, never the body**. **Per-row errors go into the stream, not thrown — a 200 does NOT mean every row succeeded.** No `revalidatePath` by design; the client calls `router.refresh()` after the final chunk. Row logic is `src/lib/bolna/calls-import.ts` `processRow`.
- **`src/lib/csv.ts`** — `csvEscape` is RFC-4180 **plus a CSV-formula-injection guard**: anything starting `= + - @ \t \r` is force-quoted with a leading apostrophe (`:13-26`). **Always export through `toCsv`/`csvEscape`** — never hand-roll joins. `withBom()` for Excel UTF-8.
- **`src/lib/csv-custom-fields.ts`** — shared discovery of dynamic columns from `lead_data`/`custom_data`, used by both leads and calls exports so they can't drift.
- **`src/lib/csv-date-ranges.ts`** — shared export-range presets so the dialog and API agree on what "Last 30 days" means.

## Shared conventions

- **Validation:** Zod **v4**, one file per domain in `src/lib/validations/`. Convention is `safeParse` + `fail(parsed.error.issues[0]?.message ?? "Invalid input")`. Timezone strings are validated by actually constructing an `Intl.DateTimeFormat`.
- **`src/lib/time.ts`** — `APP_TIMEZONE` defaults to `Asia/Kolkata`, override `APP_DEFAULT_TIMEZONE`. Provider/agent timestamps arrive as **naive wall-clock in the customer's zone**; **never parse them with bare `new Date(str)`** — use `zonedWallTimeToInstant` / `getZonedOffsetMs`. Pure, no `server-only`, so it stays testable.
- **`src/lib/phone.ts`** — `coerceToE164`. Default dial code `91`, override `DEFAULT_DIAL_CODE`. Leading `+` or >10 digits passes through untouched; a leading `0` trunk prefix is stripped; the country code is prepended **only** for a bare 10-digit number.
- **`ActionResult`** is a discriminated union — see `skelo-tenancy` §10.

## Testing

- `vitest.config.ts` — environment `node`, `include: ["src/**/*.test.ts"]`. **Tests are colocated next to source in `src/`.** The `test/` directory holds exactly one file, `test/stubs/empty.ts`, aliased over the `server-only` package so server modules import cleanly outside RSC.
- Aliases: `@` → `src/`, `server-only` → the empty stub.
- Commands: `npm test` (`vitest run`), `npm run test:watch`. No coverage config, no jsdom, **no component-render testing library installed**.
- ~20 test files, clustered on **pure logic** (`calling-window`, `outcome-decision`, `best-disposition`, `number-rotation`, `scrub`, `phone`, `time`). **Convention: extract pure decision logic into its own module so it can be unit-tested without Supabase.**
