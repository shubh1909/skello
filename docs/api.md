# Skelo Backend API Reference

All mutations and queries live in Server Actions under [src/actions/](../src/actions/). External integrations (current telephony provider — see the Voice Agent section) come in through Route Handlers under [src/app/api/](../src/app/api/). User-facing strings always say **"voice agent"** — see [CLAUDE.md](../CLAUDE.md) → *Branding & Provider Naming*.

> Looking for the UI surface (pages, layouts, navigation flow)? See [sitemap.md](sitemap.md).

---

## Table of Contents

1. [Conventions](#conventions)
2. [Setup & Environment](#setup--environment)
3. [Authentication](#authentication)
4. [Organisations](#organisations)
5. [Leads](#leads)
6. [Lead Export (CSV)](#lead-export-csv)
7. [Reminders](#reminders)
8. [Voice Agent Integration (per-org)](#voice-agent-integration-per-org)
9. [Calls](#calls)
10. [Call Transcripts](#call-transcripts)
11. [Voice Agent Webhooks](#voice-agent-webhooks)
12. [Campaigns (Bulk Outbound)](#campaigns-bulk-outbound)
13. [Realtime](#realtime)
14. [Analytics](#analytics)
15. [Admin Console](#admin-console)
16. [Security Model](#security-model)

---

## Conventions

### The `ActionResult<T>` contract

Every Server Action returns this discriminated union — no thrown errors cross the boundary:

```ts
type ActionResult<T> =
  | { success: true;  data: T }
  | { success: false; error: string };
```

**Caller pattern:**

```ts
const result = await createOrganisation({ name: "Acme", slug: "acme" });
if (!result.success) {
  toast.error(result.error);
  return;
}
const org = result.data; // narrowed to Organisation
```

Helpers `ok(data)` and `fail(error)` live in [src/types/action.ts](../src/types/action.ts).

### Validation

Every action validates its input with a Zod schema as the first step. Invalid input returns `{ success: false, error }` with the first schema issue's message.

### Multi-tenancy (Law #1)

- Every DB query is scoped by `organisation_id` in application code.
- RLS policies are a redundant safety net, not the primary gate.
- Actions never trust `organisation_id` from the client payload without verifying the authenticated user owns that org via `userOwnsOrg()`.

---

## Setup & Environment

### Required env (`.env.local`)

```ini
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>   # server-only, never exposed
BOLNA_WEBHOOK_SECRET=<shared_secret>           # for webhook signature check (inbound + call-status)
BOLNA_API_BASE_URL=https://api.bolna.ai        # optional — override for testing / self-host
CRON_SECRET=<shared_secret>                    # campaigns cron drainer; must match the value stored in Supabase Vault as `campaigns_cron_secret`
```

> Provider **API keys** are **per-organisation** — stored in the `bolna_integrations` table and configured by each org admin in Settings. Skelo itself does not hold a global provider key. The environment variable names above still reference `BOLNA_*` because that is the current provider; rename if you later abstract the service directory.

### Error monitoring (Sentry) — optional

Server + client errors are reported to Sentry when a DSN is set. Everything is a **hard no-op until `SENTRY_DSN` is present** — no build changes, no runtime overhead — so these are safe to leave unset in dev.

```ini
SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>   # server + edge; enables capture
NEXT_PUBLIC_SENTRY_DSN=<same-or-separate-dsn>               # browser capture (inlined into the client bundle)
SENTRY_ENVIRONMENT=production                               # optional — defaults to NODE_ENV
SENTRY_TRACES_SAMPLE_RATE=0                                 # optional — 0 = errors only (default); raise for perf tracing
# Source-map upload (readable prod stack traces). Only needed at build time; upload runs only when the auth token is set.
SENTRY_ORG=<org-slug>
SENTRY_PROJECT=<project-slug>
SENTRY_AUTH_TOKEN=<org-auth-token>
```

- **PII is scrubbed before anything leaves the process** — phone numbers, emails, URL query strings (incl. the Shopify recovery `?key=` checkout token), bearer tokens, and any sensitive-named field are redacted in [src/lib/observability/scrub.ts](../src/lib/observability/scrub.ts) (`sendDefaultPii` is off + `beforeSend`/`beforeSendTransaction`/`beforeBreadcrumb` all run the scrubber).
- Every server-side `console.error` is forwarded automatically (`captureConsoleIntegration`), and `logSkeloError` becomes a filterable issue tagged `skelo.tag` / `skelo.org`.
- Init lives in [src/instrumentation.ts](../src/instrumentation.ts) (server/edge), [src/instrumentation-client.ts](../src/instrumentation-client.ts) (browser), and the runtime configs `sentry.server.config.ts` / `sentry.edge.config.ts`.

### Supabase clients

| Client | File | Use in |
| --- | --- | --- |
| Browser | [src/lib/supabase/client.ts](../src/lib/supabase/client.ts) | Client Components |
| Server (cookies) | [src/lib/supabase/server.ts](../src/lib/supabase/server.ts) | Server Components, Server Actions, Route Handlers that need the user session |
| Admin (service role) | [src/lib/supabase/admin.ts](../src/lib/supabase/admin.ts) | **Only** trusted server contexts (webhooks, cron). Bypasses RLS. |
| Middleware | [src/lib/supabase/middleware.ts](../src/lib/supabase/middleware.ts) | Refreshes session cookies on every request — wired up in [src/middleware.ts](../src/middleware.ts) |

### Database

Run migrations in order:

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

Migrations (cleaned up 2026-05-08 — historical migrations consolidated into a single baseline; see `git log -- supabase/migrations/` for the original 18-file evolution):

- `20260507000000_baseline_schema.sql` — **consolidated baseline** capturing every table, enum, RLS policy, trigger, index, and RPC needed before campaigns. Idempotent (`IF NOT EXISTS` everywhere; drop-then-recreate on policies), so safe to re-apply on existing databases. Use as the single bootstrap for any fresh DB (UAT, local dev, new staging). Includes: `organisations`, `leads` (with all final-state columns: `interest`, `summary`, `pending_action`, `source`, `status`, `notes`, `city`, `pincode`, `actionable`, `recording_url`), `reminders`, `bolna_integrations`, `calls` (with `direction`, `transcript`, `transcript_status`, `transcript_fetched_at`, `language`, full unique constraint on `(organisation_id, bolna_call_id)`), `call_transcripts` (with FTS GIN index), `profiles` (with `is_admin`, `on_auth_user_created` trigger), and the `lead_call_activity` / `lead_call_activity_count` RPCs.
- `20260508000000_campaigns.sql` — bulk outbound calling. New tables `campaigns` (per-batch row with retry config + denormalized counters) and `campaign_contacts` (one row per CSV phone). `calls` gains a nullable `campaign_contact_id uuid` FK so the existing dial pipeline can carry campaign provenance with no other changes. RLS on both new tables follows the `calls` pattern (own-org SELECT/INSERT/UPDATE/DELETE). An AFTER trigger on `campaign_contacts` keeps the counters fresh and auto-flips the parent campaign to `completed` once nothing remains pending or in-flight. Both tables are added to the `supabase_realtime` publication.
- `20260508000001_campaigns_cron.sql` — companion migration. Enables `pg_cron` and `pg_net`, creates `public.campaigns_cron_tick()` (a `security definer` function that reads the cron URL and shared secret from **Supabase Vault** under names `campaigns_cron_target_url` and `campaigns_cron_secret`), and schedules `campaign-tick` to run every minute. Apply only after enabling the two extensions in the Supabase dashboard, and after running `select vault.create_secret(...)` for both names. The function is a no-op until both secrets are present, so the migration is safe to apply ahead of secret creation.

> Need to spin up a UAT or fresh-dev environment? See [uat.md](uat.md).

---

## Authentication

File: [src/actions/auth.ts](../src/actions/auth.ts)

### `signUp(input)`

Creates an auth user + a brand new organisation owned by that user in one call.

**Input**
```ts
{
  email: string;           // valid email
  password: string;        // 8–72 chars
  organisationName: string;// 2–100 chars
}
```

**Returns** `ActionResult<{ userId: string; organisationId: string }>`

The slug is auto-derived: `slugify(organisationName) + "-" + userId.slice(0,8)` to guarantee uniqueness. Rename via `updateOrganisation` afterward.

**Example** (React client form)
```tsx
"use client";
import { signUp } from "@/actions/auth";

async function onSubmit(formData: FormData) {
  const result = await signUp({
    email: formData.get("email"),
    password: formData.get("password"),
    organisationName: formData.get("org"),
  });
  if (!result.success) return setError(result.error);
  router.push(`/organisations/${result.data.organisationId}`);
}
```

> **Dashboard setting:** if Supabase **Authentication → Email → Confirm email** is ON, the user must verify via email before they can log in.

### `login(input)`

**Input**
```ts
{ email: string; password: string }
```

**Returns** `ActionResult<null>`

Writes the session cookie via Supabase SSR helpers.

```ts
const result = await login({ email, password });
if (!result.success) return setError(result.error);
router.push("/dashboard");
```

### `logout()`

Signs out and **redirects to `/login`** (throws `redirect()`, so no JSON body is returned to the caller on success).

```ts
<form action={logout}>
  <button>Sign out</button>
</form>
```

### `getCurrentUser()`

Plain read helper for Server Components — returns the Supabase `User` or `null`. No `ActionResult` wrapper.

```ts
const user = await getCurrentUser();
if (!user) redirect("/login");
```

---

## Organisations

File: [src/actions/organisations.ts](../src/actions/organisations.ts) — Type: [src/types/organisation.ts](../src/types/organisation.ts)

All actions return `ActionResult<…>`. All queries filter by `owner_id = user.id`.

### `createOrganisation(input)`

**Input**
```ts
{ name: string; slug: string }  // slug: lowercase, numbers, hyphens only
```
**Returns** `ActionResult<Organisation>`

```ts
await createOrganisation({ name: "Acme Motors", slug: "acme-motors" });
```

### `listOrganisations()`

No input. Returns `ActionResult<Organisation[]>` ordered by `created_at desc`. Only orgs where the caller is `owner_id`.

### `getOrganisation(id)`

**Input** `string` (uuid) → `ActionResult<Organisation>`.

Returns `"Organisation not found"` if the id isn't owned by the caller (does not distinguish "missing" from "forbidden" — avoids enumeration).

### `updateOrganisation(id, input)`

**Input**
```ts
id: string;                                // uuid
input: { name?: string; slug?: string };  // at least one field
```
**Returns** `ActionResult<Organisation>`.

Empty patches are rejected with `"No fields to update"`.

### `deleteOrganisation(id)`

**Returns** `ActionResult<{ id: string }>`.

⚠ Cascades: all `leads` and `reminders` for this org are deleted.

---

## Leads

File: [src/actions/leads.ts](../src/actions/leads.ts) — Type: [src/types/lead.ts](../src/types/lead.ts)

### Live columns

> ⚠ **The 2026-05-17 lead/call remodel reshaped this table.** The columns below are the **current** state. See the migrations [lead_call_remodel](../supabase/migrations/20260517000001_lead_call_remodel.sql), [dynamic_lead_fields](../supabase/migrations/20260517000002_dynamic_lead_fields.sql), and [cleanup](../supabase/migrations/20260517000003_cleanup.sql).

```
-- Identity / tenancy
id, created_at, updated_at,
organisation_id,              -- uuid, NOT NULL — the primary tenant key
                              --   (added by the remodel)
org_slug,                     -- text — denormalized convenience FK to
                              --   organisations.slug; kept for back-compat,
                              --   slated for a future cleanup
phone,                        -- nullable; consumed by the WhatsApp dialog
phone_normalized,             -- GENERATED (digits only) — the dedupe/match key
first_seen_at, last_contact_at,

-- Current view (admin-editable; the inbound webhook also fills name/intent)
name,
current_intent (enum intent_type: hot | warm | cold),   -- temperature
city, pincode,

-- Admin-owned (the inbound webhook never writes these)
status (enum lead_status:
   new | contacted | qualified | negotiating | won | lost)
       NOT NULL DEFAULT 'new',                          -- pipeline stage
source (enum lead_source:
   inbound_call | whatsapp | manual | import | web_form),
notes,
pending_action,               -- NOT NULL DEFAULT true — true = a follow-up
                              --   is still owed by the team

-- Dynamic fields (the remodel's "dynamic lead fields" model)
lead_data    jsonb NOT NULL DEFAULT '{}',   -- full provider extraction
custom_data  jsonb NOT NULL DEFAULT '{}',   -- free-form catch-all
search_tsv,                   -- GENERATED tsvector over name + notes +
                              --   lead_data values; backs free-text search
```

**What the remodel dropped from `leads`:** `external_id`, `interest`, `summary`, `actionable`, `recording_url`, `customer_status`, `wants_to_connect_on_watsapp`, `visit_date_time`, and `lead_intent`. Per-call snapshots (`summary`, `actionable`, `recording_url`) now live on `calls`; everything else the agent extracts lands in `lead_data` jsonb (described by `lead_field_definitions`).

**Back-compat aliases.** The `Lead` type ([src/types/lead.ts](../src/types/lead.ts)) still **exposes** the old field names, but they are now **derived on read** by `actions/leads.ts` so existing UI keeps working — they are not real columns:

| Exposed field | Derived from |
| --- | --- |
| `lead_intent` | `current_intent` |
| `interest` | `lead_data.interest` |
| `customer_status` | `lead_data.customer_status` |
| `wants_to_connect_on_watsapp` | `lead_data.connect_on_whatsapp` |
| `visit_date_time` | `lead_data.date_and_time_of_visit` |
| `summary` / `actionable` / `recording_url` | latest linked `calls` row |
| `external_id` | always `null` |

Tenant scoping is via **`organisation_id` (uuid, NOT NULL)** — the primary key for all RLS and app-layer checks since the remodel. The legacy **`org_slug` (text)** column is retained (FK `leads.org_slug → organisations.slug`, cascade on update/delete) and still used by the `lead_call_activity` RPCs and the leads realtime channel; it will be dropped in a later cleanup.

**Two "status" notions, deliberately distinct:**

- `status` — the **pipeline stage** enum (new → contacted → qualified → negotiating → won/lost). A real column, authoritative on the server, but **hidden from the leads table UI since 2026-04-27** (still shown in the detail sheet; `listLeads` still accepts it as a filter so deep links work).
- `customer_status` — a **free-form** buyer-type label ("Buyer", "Owner", "Service"). Now stored in `lead_data.customer_status` and surfaced via the alias above; still labelled **Customer type** in the UI.

`current_intent` (hot/warm/cold) is a **temperature**, independent of both — a "hot" lead can be `new` or `qualified` or `lost`.

**Idempotency**: the unique index `(organisation_id, phone_normalized)` means the inbound webhook finds-or-creates one lead per normalized phone per org — retries (and concurrent inserts) converge on the same row. (Pre-remodel this was keyed on `external_id`, which no longer exists on `leads`.)

> Column names are `watsapp` (not `whatsapp`). Code mirrors the DB exactly — renaming later would need a migration plus coordinated code change.

### `listLeads(input)`

**Input**
```ts
{
  org_slug: string;                           // required
  limit?: number;                             // 1–200, default 50
  offset?: number;                            // default 0
  q?: string;                                 // free-text over name/interest/phone
  lead_intent?: "hot" | "warm" | "cold";
  customer_status?: string;                   // free-form "buyer type"
  pending_action?: boolean;                   // true = action still owed
  wants_to_connect_on_watsapp?: boolean;
  has_phone?: boolean;                        // reserved — no UI exposes it today
  status?: "new" | "contacted" | "qualified"
        | "negotiating" | "won" | "lost";
  source?: "inbound_call" | "whatsapp" | "manual" | "import" | "web_form";
}
```
**Returns** `ActionResult<{ items: Lead[]; total: number }>` — full `Lead` shape ordered by `created_at desc`.

The leads filter bar ([src/components/app/leads-filter-bar.tsx](../src/components/app/leads-filter-bar.tsx)) exposes: search (q), Intent, Source, Pending action, Wants WhatsApp. **The Status filter was removed from the UI** on 2026-04-27 alongside hiding the Status column in the leads table; the `status` query param is still honoured by `listLeads` so deep links continue to work. **The "Has phone" filter was removed** on 2026-04-24 for being noise; `has_phone` remains on the server schema if a programmatic caller needs it.

**Example** (Server Component)
```tsx
const result = await listLeads({ org_slug: "acme-motors", limit: 50 });
if (!result.success) throw new Error(result.error);
return <LeadTable rows={result.data.items} total={result.data.total} />;
```

### `getLead(id)`

Returns the full `Lead` including every column from the live schema. Caller must own the organisation whose `slug` equals the lead's `org_slug`.

### `createLead(input)`

**Input**
```ts
{
  org_slug: string;                                    // required
  name?: string | null;
  interest?: string | null;                            // ≤ 500 chars (renamed from product, 2026-04-27)
  summary?: string | null;                             // ≤ 5000 chars (added 2026-04-27)
  customer_status?: string | null;                     // free-form buyer type
  lead_intent?: "hot" | "warm" | "cold" | null;
  phone?: string | null;                               // ≤ 32 chars; UI normalises before wa.me
  wants_to_connect_on_watsapp?: boolean | null;
  visit_date_time?: string | null;                     // ISO 8601 with offset
  // Added 2026-04-24:
  source?: "inbound_call" | "whatsapp" | "manual"
        | "import" | "web_form" | null;
  status?: "new" | "contacted" | "qualified"
        | "negotiating" | "won" | "lost";              // DB default 'new'
  notes?: string | null;                               // ≤ 5000 chars
  city?: string | null;                                // ≤ 100 chars
  pincode?: string | null;                             // ≤ 20 chars
  // Added 2026-04-29:
  actionable?: string | null;                          // ≤ 1000 chars; concrete next step
  recording_url?: string | null;                       // valid URL, ≤ 2000 chars
}
```

`LeadCreateDialog` stamps `source: "manual"` implicitly for anything captured through the UI; the inbound webhook stamps `source: "inbound_call"` and writes `actionable` + `recording_url` directly from the post-call payload.

### `updateLead(id, input)`

Same shape as create minus `org_slug`, plus `pending_action?: boolean`. Empty patches rejected.

### `deleteLead(id)`

Hard-deletes. Linked reminders have `lead_id` set to null.

### `toggleLeadPendingAction(id)`

Fetches the current `pending_action` and flips it. Returns the updated `Lead`. (Renamed from `toggleLeadContactedOnWhatsApp` on 2026-04-27 along with the column rename.)

```ts
// In a row action button
async function onToggle(leadId: string) {
  const res = await toggleLeadPendingAction(leadId);
  if (!res.success) toast.error(res.error);
}
```

The UI's WhatsApp dialog ([src/components/app/whatsapp-dialog.tsx](../src/components/app/whatsapp-dialog.tsx)) calls this automatically after the user clicks **Open WhatsApp** — `wa.me/<digits>?text=<encoded message>` opens in a new tab and `pending_action` is flipped to `false` in the same transition.

---

## Lead Export (CSV)

File: [src/app/api/leads/export/route.ts](../src/app/api/leads/export/route.ts)
UI: [src/components/app/lead-export-dialog.tsx](../src/components/app/lead-export-dialog.tsx) — triggered from the `/leads` header, adjacent to the **New lead** button.

### `GET /api/leads/export`

Session-authed (not a webhook). The organisation slug is resolved from the caller's session — **never** trusted from query params. Streams a UTF-8 CSV with a BOM so Excel opens non-ASCII names correctly.

**Query params**

| Param | Value | Effect |
| --- | --- | --- |
| `range` | `today` | `created_at` ≥ now − 24h |
| `range` | `yesterday` | 24–48h ago |
| `range` | `last_week` | last 7 days |
| `range` | `last_month` | last 30 days |
| `range` | `all` | no date filter (default) |

**Columns (in order):** ID, Created At, Name, Phone, Product, Intent, Status, Source, Customer Type, City, Pincode, Visit, WA Contacted, Wants WA, Notes, Capture ID.

**Responses**

| Status | Body |
| --- | --- |
| `200` | `text/csv; charset=utf-8` — `Content-Disposition: attachment; filename="skelo-leads-<range>-<YYYY-MM-DD>.csv"` |
| `400` | `{ error: "Invalid range. Use today, yesterday, last_week, last_month, or all." }` |
| `500` | `{ error: "<supabase message>" }` |

Capped at **10,000 rows** per export. Escaping follows RFC 4180: fields containing `"`, `,`, CR, or LF are wrapped in double quotes with embedded quotes doubled. Booleans render as `yes` / `no`; nulls as empty.

---

## Reminders

File: [src/actions/reminders.ts](../src/actions/reminders.ts) — Type: [src/types/reminder.ts](../src/types/reminder.ts)

### Enums

```ts
type ReminderType   = "call" | "whatsapp" | "email" | "visit" | "other";
type ReminderStatus = "pending" | "done" | "dismissed";
```

### `listReminders(input)`

**Input**
```ts
{
  organisation_id: string;
  limit?: number;                       // 1–200, default 50
  offset?: number;                      // default 0
  status?: ReminderStatus;
  type?: ReminderType;
  lead_id?: string;                     // filter reminders for a single lead
  from?: string;                        // ISO — remind_at >= from
  to?: string;                          // ISO — remind_at <= to
}
```
Ordered by `remind_at` ascending. Ideal for "upcoming this week" views.

**Example: today's pending reminders**
```ts
const now = new Date();
const endOfDay = new Date(now);
endOfDay.setHours(23,59,59,999);

const res = await listReminders({
  organisation_id: orgId,
  status: "pending",
  from: now.toISOString(),
  to: endOfDay.toISOString(),
});
```

### `createReminder(input)`

**Input**
```ts
{
  organisation_id: string;
  lead_id?: string | null;     // verified to belong to the same org
  title: string;               // 1–200
  notes?: string | null;       // ≤ 2000
  remind_at: string;           // ISO 8601 with offset
  type?: ReminderType;         // default "other"
}
```
Auto-stamps `created_by = user.id` and `status = "pending"`.

If `lead_id` points to a lead in a **different** org, the action fails — prevents cross-tenant linking.

### `getReminder(id)`, `updateReminder(id, input)`, `deleteReminder(id)`

Standard shapes. `updateReminder` has a special rule: setting `status = "done"` stamps `completed_at = now()`; setting any other status clears it.

### `markReminderDone(id)` / `markReminderPending(id)`

Shortcuts over `updateReminder`. Use these from UI toggles.

```ts
<Checkbox
  checked={reminder.status === "done"}
  onCheckedChange={async (v) => {
    const fn = v ? markReminderDone : markReminderPending;
    const res = await fn(reminder.id);
    if (!res.success) toast.error(res.error);
  }}
/>
```

---

## Voice Agent Integration (per-org)

Files:
- Actions: [src/actions/bolna-integrations.ts](../src/actions/bolna-integrations.ts)
- Type: [src/types/bolna-integration.ts](../src/types/bolna-integration.ts)
- Table: `public.bolna_integrations` — primary key is `organisation_id`. RLS enabled with **no** policies for authenticated users; all access is via the service-role admin client, gated by `userOwnsOrg()`.
- UI: Settings → **Voice agent integration** card ([src/components/app/bolna-integration-form.tsx](../src/components/app/bolna-integration-form.tsx)).

> Internal filenames, table names, and function identifiers still reference the current provider. User-facing copy always says **"voice agent"** — this is enforced by the rule in [CLAUDE.md](../CLAUDE.md) → *Branding & Provider Naming*.

### Why this design

Each tenant has its own provider account, agent, and API key. Storing one row per org keeps tenants fully isolated, and making the table invisible to the user-session Supabase client keeps the `api_key` column off the wire — the key never appears in a browser request, even accidentally.

The public `BolnaIntegration` type exposes `api_key_last4` for display; the full key is only visible server-side when invoking the provider API.

`daily_calls_per_number` (default 200) is **dormant** — it was the old fixed per-number/day spam cap, now superseded by per-campaign connect-rate switching (see *Campaigns → Caller-ID switching*). The column remains for back-compat but the dispatcher no longer reads it, and the admin field was removed from the voice-agent form.

### `getBolnaIntegration(organisationId)`

**Input** `string` (uuid) — must belong to the caller's owned org.
**Returns** `ActionResult<BolnaIntegration | null>` — `null` if the org has not configured Bolna yet.

### `upsertBolnaIntegration(input)`

**Input**
```ts
{
  organisation_id: string;
  agent_id: string;                  // 1–200 chars, from Bolna dashboard
  api_key: string;                   // 1–500 chars, stored server-only
  from_phone_number?: string | null; // optional default caller ID, 5–32 chars
  enabled?: boolean;                 // default true
}
```

**Returns** `ActionResult<BolnaIntegration>` (without the full key).

```ts
await upsertBolnaIntegration({
  organisation_id: orgId,
  agent_id: "9c5f-...",
  api_key: "sk-...",
  from_phone_number: "+91-99999-00000",
});
```

### `updateBolnaIntegration(input)`

Same shape, all fields optional except `organisation_id`. Omit `api_key` to keep the current one. Empty patches rejected.

### `deleteBolnaIntegration(organisationId)`

Removes the integration. Outbound calls will fail with `"Voice agent not configured. Set it up in Settings."` until it's re-added.

### Testing the integration from Settings

1. Log into Skelo as an org owner.
2. Navigate to **Settings → Voice agent integration**.
3. Paste the agent ID and API key from your voice agent provider's dashboard → **Connect voice agent**.
4. The card should flip to **Connected**. The api_key field clears; the placeholder shows `sk-••••<last 4>` as confirmation.
5. To verify the key is not exposed: open browser DevTools → Network → refresh — the Settings response does not contain the full api_key (only `api_key_last4`).

---

## Calls

Files:
- Action: [src/actions/calls.ts](../src/actions/calls.ts)
- Client: [src/lib/bolna/client.ts](../src/lib/bolna/client.ts)
- Enrichment worker: [src/lib/bolna/enrich.ts](../src/lib/bolna/enrich.ts)
- Type: [src/types/call.ts](../src/types/call.ts)
- Table: `public.calls` — tenant-scoped, RLS tied to org ownership.

### Live columns

```
id, organisation_id, lead_id, initiated_by, bolna_call_id,
to_phone,                -- nullable (restricted-CLI inbound is real)
from_phone, agent_id,
status (enum: initiated | ringing | in_progress | completed
             | failed | no_answer | busy | canceled),
direction (enum: inbound | outbound)    NOT NULL DEFAULT 'outbound',
error_code, error_message,
started_at, answered_at, ended_at,
duration_seconds,
recording_url, transcript_url, summary,

-- Added 2026-04-24 (20260424000001_calls_direction_and_transcripts.sql):
transcript,                              -- raw blob from provider's
                                         --   GET /executions/{id}
transcript_status (enum: pending | processing | ready | failed | skipped)
                                         --  ingestion lifecycle
transcript_fetched_at,
language,                                -- e.g. "hi-IN"

-- Per-call extraction (added by the 2026-05-17 remodel) — the agent's
-- read of THIS conversation, kept on the call (the lead holds the rollup):
name_extracted, interest, lead_intent_extracted (enum intent_type),
actionable, customer_status, visit_scheduled_at, connect_on_whatsapp,

-- Dynamic fields, mirroring leads (added 2026-05-17):
lead_data    jsonb NOT NULL DEFAULT '{}',
custom_data  jsonb NOT NULL DEFAULT '{}',

-- Disposition (added 2026-06-08) — per-org vocabulary, NO fixed CHECK
-- (the outcome enum was dropped 2026-06-10); resolved vs org_outcome_policies:
call_outcome,            -- semantic disposition key (what the customer wanted)
requested_callback_at,   -- when the customer asked to be re-called

is_test (boolean NOT NULL DEFAULT false),  -- added 2026-05-27; test-call dials
                                           --   are excluded from headline stats
campaign_contact_id,     -- nullable FK → campaign_contacts (the campaign seam)

created_at, updated_at
```

**Idempotency:** **full** unique constraint `(organisation_id, bolna_call_id)` (promoted from a partial index in `20260428000000_calls_full_bolna_call_id_unique.sql`). NULL `bolna_call_id` rows still coexist because PostgreSQL treats nulls as distinct in unique constraints. PostgREST `.upsert(..., { onConflict: "organisation_id,bolna_call_id" })` matches this constraint cleanly — a partial index would need its `WHERE` clause echoed in the upsert, which `supabase-js` doesn't do.

### `initiateCall(input)`

**Input** `{ lead_id: string }` (uuid).

**Flow:**
1. Resolve the lead → get `org_slug` + `phone`.
2. Verify the authenticated user owns that org.
3. Fetch the org's `bolna_integrations` row via the admin client.
4. Call `POST ${BOLNA_API_BASE_URL}/call` with `{ agent_id, recipient_phone_number, from_phone_number?, user_data: { lead_id, organisation_id, lead_name } }` and `Authorization: Bearer <api_key>`.
5. Insert a `calls` row with `direction = 'outbound'`, `status = 'initiated'`, and `bolna_call_id` from the provider's response.
6. If the provider errors, a `calls` row with `status = 'failed'` and `error_message` is still inserted for audit.

Transcript fetch is **not** done here — it happens asynchronously when the calls webhook delivers `status = 'completed'` (see [Call Transcripts](#call-transcripts)).

**Returns** `ActionResult<Call>`.

**Failure reasons:**
- `"Lead has no phone number"` — lead's `phone` is null.
- `"Voice agent not configured. Set it up in Settings."` — no row in `bolna_integrations`.
- `"Voice agent is disabled for this workspace."` — `enabled = false`.
- Any string bubbled up from `BolnaApiError`.

### `listCalls(input)`

**Input**
```ts
{
  organisation_id: string;
  limit?: number;                       // 1–500, default 50
  offset?: number;                      // default 0
  lead_id?: string;                     // filter to a single lead
  status?: CallStatus;                  // "initiated" | "ringing" | "in_progress"
                                        // | "completed" | "failed" | "no_answer"
                                        // | "busy" | "canceled"
  // Added 2026-04-26:
  direction?: "inbound" | "outbound";
  agent_id?: string;                    // ≤ 200 chars
  call_outcome?: string;                // semantic disposition key (eq filter) —
                                        //   per-org configurable, so an open string
  from?: string;                        // ISO datetime — started_at >= from
  to?: string;                          // ISO datetime — started_at <= to
  q?: string;                           // free-text over to_phone / from_phone /
                                        //   bolna_call_id (uses ilike)
}
```
Returns `ActionResult<{ items: Call[]; total: number }>`, ordered by `started_at desc`. Each `Call` carries the full column set, including `direction`, `call_outcome`, `requested_callback_at`, `transcript`, and `transcript_status`. (All filters live in `applyCallFilters` — [src/lib/queries/call-filters.ts](../src/lib/queries/call-filters.ts) — shared with the CSV export route so the two paths never drift.)

### `listConversations(input)`

Same input as `listCalls` but each row is enriched with the linked lead's name and phone via a PostgREST embed (`lead:leads(name, phone)`). Used by the `/conversations` page so it can render **Lead / Number** in one query without a join in JS.

```ts
type CallWithLead = Call & {
  lead: { name: string | null; phone: string | null } | null;
};
```

**Returns** `ActionResult<{ items: CallWithLead[]; total: number }>`.

### `listConversationAgents(organisationId)`

Returns the distinct `agent_id` values seen on this org's most recent 500 calls. Drives the **All agents** dropdown on `/conversations`.

**Returns** `ActionResult<string[]>`.

### `listCampaignOutcomeOptions(organisationId)`

Returns the org's configured outcome keys + labels from `org_outcome_policies` (RLS-scoped read after an ownership check — no admin client). Populates the **Outcome** dropdown on the campaign detail **Calls** tab filter bar.

**Returns** `ActionResult<{ key: string; label: string }[]>`.

#### Campaign Calls tab — filtering & disposition

The campaign detail Calls tab ([page.tsx](../src/app/(app)/campaigns/[id]/page.tsx)) renders a `CampaignCallsFilterBar` ([src/components/app/campaign-calls-filter-bar.tsx](../src/components/app/campaign-calls-filter-bar.tsx)) above the shared `ConversationsTable`. Filters are URL-driven (`?tab=calls&status=…&outcome=…&q=…`) and always preserve `tab=calls`; changing one remounts the table so infinite-scroll resets to page 1. The table shows a **Disposition** column (`call_outcome`, prettified, with the `requested_callback_at` time underneath when present) — visible on `/conversations` too.

When scoped to a campaign (`campaign_id` set), `listConversations` also enriches each row with `best_outcome: string | null` and the table adds a **Best disposition** column — the highest-priority disposition that row's *contact* reached across **all** its attempts (not just this call). See *Best disposition* below. The column is hidden on the org-wide `/conversations` list (no campaign context).

### UI triggers

- **Outbound:** the leads table ([src/components/app/leads-table.tsx](../src/components/app/leads-table.tsx)) renders a **phone icon button** per row. Clicking it calls `initiateCall({ lead_id })`; the button is disabled when the lead has no phone.
- **Conversations page** ([src/app/(app)/conversations/page.tsx](../src/app/(app)/conversations/page.tsx)) lists every inbound + outbound call for the org with filters (range, agent, outcome, direction, search). Click a row → `CallTranscriptDialog`. **Audio → Play** opens `recording_url`.
- Call-history rows in the lead detail sheet show a direction glyph (↙ inbound / ↗ outbound) and expose a "View transcript" action when `transcript_status = 'ready'`.

---

## Call Transcripts

Files:
- Parser: [src/lib/bolna/transcript.ts](../src/lib/bolna/transcript.ts)
- Enrichment worker: [src/lib/bolna/enrich.ts](../src/lib/bolna/enrich.ts)
- Read action: [src/actions/call-transcripts.ts](../src/actions/call-transcripts.ts)
- Type: [src/types/call-transcript.ts](../src/types/call-transcript.ts)
- UI: [src/components/app/call-transcript-dialog.tsx](../src/components/app/call-transcript-dialog.tsx)
- Table: `public.call_transcripts` — child of `calls` (cascade on delete), RLS tied to `organisations.owner_id`.

### Shape

Raw transcripts stay on `calls.transcript` as plain text — that's the source of truth and what we receive from the provider's `GET /executions/{id}`. The parser splits that blob into structured turn rows:

```
call_transcripts (
  id, call_id, organisation_id,
  seq          int,                 -- 0-based ordinal within the call
  speaker      enum (agent | user | system),
  text         text,
  started_ms   int (nullable),      -- reserved for a future provider that
  ended_ms     int (nullable),      --   ships per-turn timestamps
  confidence   numeric(4,3) (nullable),
  created_at
)
UNIQUE (call_id, seq)
GIN index on to_tsvector('simple', text)   -- multi-language FTS
```

Why structured + raw side-by-side: the raw blob makes the parser replaceable without data loss. If the parser can't interpret a line, everything falls through to a single `system` turn so FTS still works.

### Ingestion lifecycle

`calls.transcript_status` walks through:

- `pending` → row freshly inserted, no fetch attempted
- `processing` → fetch in flight (raw blob already written)
- `ready` → raw blob + parsed turns both stored
- `failed` → fetch attempted and failed; retry later
- `skipped` → the provider produced no transcript (e.g. call never answered)

### `fetchBolnaExecution({ apiKey, executionId })`

Helper in [src/lib/bolna/client.ts](../src/lib/bolna/client.ts) that hits `GET ${BOLNA_API_BASE_URL}/executions/{id}`. Returns a typed `ExecutionPayload`:

```ts
{
  id: string;
  status?: string;
  conversation_time?: number;
  transcript?: string | null;
  telephony_data?: { to_number?: string; from_number?: string } | null;
  extracted_data?: Record<string, unknown> | null;
  answered_by_voice_mail?: boolean | null;
  error_message?: string | null;
  created_at?: string;
  updated_at?: string;
}
```

Throws `BolnaApiError` on non-2xx.

### Inline ingestion (current path)

The unified webhook (`/api/webhooks/bolna/leads`) writes transcripts **inline** during the request — the post-call payload already contains the full transcript blob, so no executions API roundtrip is needed:

| Helper | File | Caller | Behavior |
| --- | --- | --- | --- |
| `recordInboundCall({ organisationId, leadId, externalId, payload })` | [src/lib/bolna/inbound.ts](../src/lib/bolna/inbound.ts) | Inbound webhook (sync) | Upserts the `calls` row (`direction='inbound'`) from the webhook payload — phones, duration, recording_url, transcript, status — then calls `writeTranscriptTurns()`. |
| `recordOutboundResult({ externalId, payload })` | [src/lib/bolna/outbound.ts](../src/lib/bolna/outbound.ts) | Outbound webhook (sync) | Looks up the existing call by `bolna_call_id`, patches it with the outcome (status, duration, recording, transcript, summary, ended_at, error_message), flows agent extraction back to the linked lead, then calls `writeTranscriptTurns()`. |
| `writeTranscriptTurns(callId, organisationId, transcript)` | [src/lib/bolna/inbound.ts](../src/lib/bolna/inbound.ts) | Both helpers above | Parses the transcript blob via `parseTranscript()`, deletes any prior turns for the call, and bulk-inserts the new ones. Updates `calls.transcript_status` to `ready` / `skipped` / `failed`. |

### Legacy executions-API path

`src/lib/bolna/enrich.ts` still exposes two helpers that fetch `GET /executions/{id}` and walk the same upsert/turn-insert flow. They were the original ingestion path before the post-call webhook was discovered to carry the full transcript inline.

- `enrichInboundLead` — **no longer wired up**. The unified webhook does the work synchronously via `recordInboundCall`. Keep until we're confident no future provider quirk requires re-fetching.
- `enrichOutboundCall` — still called from the legacy `/api/webhooks/bolna/calls` route. New agent configurations should use the unified `/api/webhooks/bolna/leads` endpoint, in which case `recordOutboundResult` runs inline and `enrichOutboundCall` is unused.

Both legacy helpers:
- Resolve the org's API key, skip cleanly if the integration is missing or disabled.
- Fetch `GET /executions/{id}` with bounded retries (0s, 0.8s, 2s) because the provider is eventually consistent.
- Never throw — logged failures mark `transcript_status = 'failed'`.

### `listCallTranscript({ call_id })`

Server action returning the ordered turns for a call. RLS on `call_transcripts` scopes to the caller's org; no explicit `organisation_id` filter in the action.

**Returns** `ActionResult<CallTranscriptTurn[]>` ordered by `seq ASC`.

```ts
const res = await listCallTranscript({ call_id: "…" });
if (!res.success) toast.error(res.error);
else setTurns(res.data);
```

---

## Voice Agent Webhooks

### One unified endpoint (2026-04-28 redesign)

The provider's agent dashboard exposes **one** post-call webhook URL per agent — it fires for every call from that agent regardless of direction. Skelo uses a single endpoint for both inbound and outbound flows and dispatches internally on `telephony_data.call_type`.

| Route | File | Purpose |
| --- | --- | --- |
| `POST /api/webhooks/bolna/leads` | [src/app/api/webhooks/bolna/leads/route.ts](../src/app/api/webhooks/bolna/leads/route.ts) | **The unified post-call webhook.** Routes inbound payloads to `recordInboundCall` (creates lead + call row) and outbound payloads to `recordOutboundResult` (patches the existing call row from `initiateCall`). |
| `POST /api/webhooks/bolna/calls` | [src/app/api/webhooks/bolna/calls/route.ts](../src/app/api/webhooks/bolna/calls/route.ts) | **Legacy** status-only updater that expects a slim `{ call_id, status, ... }` payload. The unified route on `/api/webhooks/bolna/leads` supersedes it for new agent configurations. Kept for backward compatibility. |

### Shared auth

The provider's dashboard accepts a webhook URL only — no custom headers. Both endpoints accept the shared secret in **either** of two places, compared in constant time:

1. `x-bolna-signature: <BOLNA_WEBHOOK_SECRET>` header — for curl tests.
2. `?secret=<BOLNA_WEBHOOK_SECRET>` query string — for the provider dashboard.

Generate a long random secret (`openssl rand -hex 32`), put it in `.env.local`, and append it to the URL you paste into the dashboard.

> **If the provider later adds HMAC signing**, replace the comparison with `crypto.createHmac("sha256", secret).update(rawBody).digest("hex")` and drop the query-string path. The query-string route is a pragmatic workaround, not a permanent design.

### Per-call event lifecycle

Bolna fires the webhook **three times per call** as the execution moves through its lifecycle:

| # | `status` | `extracted_data` | What we do |
| --- | --- | --- | --- |
| 1 | `in-progress` | `null` | Validate, log, return `200 { ignored: "no extracted_data" }` |
| 2 | `call-disconnected` | `null` | Same — wait for the final fire |
| 3 | `completed` | populated | **Process** — branch on `telephony_data.call_type` |

The early-return on missing `extracted_data` is what keeps Bolna from retrying the prelim events forever. The route never inserts partial state from those.

### Payload schema — [src/lib/bolna/extract.ts](../src/lib/bolna/extract.ts)

The same payload schema covers both inbound and outbound — they only differ in `telephony_data.call_type` and which fields the agent populated. Notable points:

- `extracted_data` is **nullable** — required so the prelim events validate.
- Each field inside `extracted_data.lead_data.<field>` carries `subjective`, `objective`, `reasoning_subjective`, `reasoning_objective`, `confidence`, `confidence_label`, and `validation`. **All of these accept `null`** — the agent leaves the side it didn't pick as `null`, which broke a stricter older schema.
- Top-level fields we consume: `status`, `user_number` (the caller, on inbound), `transcript`, `summary`, `agent_id`, `conversation_duration` (number, seconds), `created_at`, `updated_at`, `error_message`.
- `telephony_data.{ to_number, from_number, recording_url, call_type }`.
- Extra keys are allowed via `passthrough()` and ignored.

### Extraction rules

> **Post-remodel destinations.** Extracted lead fields no longer write to dedicated `leads` columns (most were dropped). They are merged into **`leads.lead_data`** jsonb by `lib/bolna/lead-merge.ts` — **lock-aware**: any field a human has pinned via `lead_field_overrides` is skipped (see `lead_locked_fields`). Each discovered key is also registered in `lead_field_definitions` so admins can promote it to a visible column. The per-call `summary` / `actionable` / `recording_url` are written to the **`calls`** row and surfaced on the lead via the latest-call aliases.

- For each `lead_data` field, `pickValue()` prefers `subjective`, falls back to `objective`. Empty strings are treated as absent.
- `lead_data.product` → `leads.lead_data.interest`. The webhook payload still uses `product` for backward compatibility.
- `lead_data.actionable.subjective` → `calls.actionable` (free-form next-step string; surfaced on the lead via the latest-call alias).
- `connect_on_whatsapp` is coerced via `toBoolean()` (accepts `true|false|yes|no|1|0`) → `leads.lead_data.connect_on_whatsapp`.
- `date_and_time_of_visit` is coerced via `toTimestamp()` (parseable ISO → UTC ISO; otherwise null) → `leads.lead_data.date_and_time_of_visit`.
- `call_outcome` → `calls.call_outcome` via `coerceCallOutcome()` (normalises to a stable key — trim/lowercase/underscore — and maps the standard aliases; **custom keys pass through**, since outcomes are per-org configurable). `callback_at` → `calls.requested_callback_at` via `toTimestamp()`. These drive disposition-based campaign retry, resolved against the org's `org_outcome_policies` (see *Campaign post-step → Configurable outcome policy*).
- `lead_intent` is lowercased, matched against the `LeadIntent` enum, and written to `leads.current_intent`.
- A per-field `confidence` map is captured.
- **Summary**: `buildSummary()` concatenates each field's `reasoning_subjective` as `<Humanised Field>: <reasoning>` paragraphs into `calls.summary`. On idempotent retry the upsert overwrites — agent-generated summaries are replaced on each call.

### Inbound flow — `recordInboundCall`

File: [src/lib/bolna/inbound.ts](../src/lib/bolna/inbound.ts).

When `telephony_data.call_type === "inbound"`:

1. **Lead find-or-create** (admin client) keyed on `(organisation_id, phone_normalized)` so retries don't duplicate. The row stamps identity (`phone` from top-level `user_number`, `source: "inbound_call"`, `first_seen_at`/`last_contact_at`); `name` and `current_intent` are filled from the extraction, and every other extracted field is merged into `leads.lead_data` (lock-aware — see the *Post-remodel destinations* note above). `summary` / `actionable` / `recording_url` are written to the `calls` row in step 2, not the lead.
2. **Call row upsert** keyed on `(organisation_id, bolna_call_id)`. Fields populated from the webhook: `direction: "inbound"`, `to_phone` (`telephony_data.to_number` — our agent line), `from_phone` (`telephony_data.from_number` — the caller), `agent_id`, `status` (mapped), `duration_seconds` (from `conversation_duration`), `recording_url`, `transcript`, `transcript_status` (`ready` if transcript present, else `skipped`), `started_at` / `ended_at` from the payload's `created_at` / `updated_at`.
3. **Transcript turns** parsed inline via `parseTranscript()` and bulk-inserted into `call_transcripts` (existing turns deleted first so retries produce a clean set).

The webhook payload has everything we need, so **no executions API roundtrip is required**. The legacy `enrichInboundLead` helper still exists in [src/lib/bolna/enrich.ts](../src/lib/bolna/enrich.ts) but is no longer called from the route.

### Outbound flow — `recordOutboundResult`

File: [src/lib/bolna/outbound.ts](../src/lib/bolna/outbound.ts).

For outbound calls, the call row already exists in our DB — `initiateCall` created it the moment we placed the call. When `telephony_data.call_type === "outbound"`:

1. **Find** the existing call by `bolna_call_id`. If none → `200 { matched: false }` (we didn't initiate it; benign no-op).
2. **Patch** the call row with `status` (mapped), `duration_seconds`, `recording_url`, `transcript`, `transcript_status`, `transcript_fetched_at`, `ended_at`, `summary`, `error_message`.
3. **Flow extraction back to the linked lead** — touch only fields the agent populated this turn: `actionable`, `summary`, `recording_url`, `lead_intent`, `customer_status`, `visit_date_time`, `wants_to_connect_on_watsapp`. Phone, name, address etc. are not overwritten.
4. **Transcript turns** parsed and inserted via the same shared `writeTranscriptTurns()` helper.

This is what turns "Calling …" rows into **Completed** rows on the Conversations page once Bolna delivers the final webhook event.

### Routing & idempotency

- Inbound: org is resolved from the trusted `agent_id` via `resolveOrgByAgentId` (`resolve_org_by_agent` RPC on the `voice_agents` registry), with the dialed number (`to_number`) as a DID fallback (`resolve_org_by_dialed_number`). All via the **admin client** (webhook is not an authenticated session). The LLM-emitted `business_slug` is captured as `advisory_business_slug` for observability **but never used to route** — a mismatch between it and the agent-resolved org is logged, not acted on.
- Outbound: org is implied by the existing call row's `organisation_id` — no lookup needed.
- Lead find-or-create keyed on `(organisation_id, phone_normalized)`. Call upsert keyed on `(organisation_id, bolna_call_id)`. Both retries produce at most one row.

### Responses

| Status | When |
| --- | --- |
| `200 { ok: true, ignored: "no extracted_data" }` | Prelim event (`in-progress` / `call-disconnected`) |
| `200 { id: "<lead uuid>" }` | Inbound lead recorded |
| `200 { ok: true, callId, matched }` | Outbound call updated (or no-op match=false) |
| `400` | Invalid JSON / schema / missing `agent_id` (inbound, with no DID fallback match) / missing execution id (outbound) |
| `401` | Missing or wrong secret |
| `404` | Inbound `agent_id` (and DID fallback) doesn't resolve to any org |
| `500` | Supabase lookup/insert/update failed |

### Configuring the webhook in the Bolna dashboard

Each Bolna agent has its own post-call webhook URL — the same URL is used by inbound and outbound calls from that agent. Open the agent settings (in **Bolna Dashboard → Agent → Analytics → Post Call Tasks** or the equivalent webhook field on your agent), and paste:

```
https://<your-public-host>/api/webhooks/bolna/leads?secret=<BOLNA_WEBHOOK_SECRET>
```

For local dev, expose `localhost:3000` with cloudflared / ngrok / similar:

```bash
# in one terminal
npm run dev
# in another
ngrok http 3000        # or: cloudflared tunnel --url http://localhost:3000
# copy the public https URL
```

Then paste `https://<tunnel>/api/webhooks/bolna/leads?secret=<BOLNA_WEBHOOK_SECRET>` into the agent's webhook field.

**You configure the same URL on every agent** — inbound, outbound, hybrid. Skelo dispatches internally on `telephony_data.call_type`. There is no "outbound webhook" you need to wire up separately; the Bolna UI doesn't surface one anyway.

> **Why a query string?** Bolna's UI doesn't let you add custom headers, so the server accepts the secret either via `x-bolna-signature` header (for curl) or `?secret=…` query string (for Bolna). Rotate the secret if it ever leaks — proxy logs and referrers can capture URLs.

### Test inbound with curl

PowerShell (use `Invoke-RestMethod` — `curl` is an alias for `Invoke-WebRequest` and chokes on bash-style line continuation):

```powershell
$body = @'
{
  "id": "test-exec-001",
  "status": "completed",
  "user_number": "+919999900000",
  "agent_id": "agent-uuid",
  "conversation_duration": 12.5,
  "created_at": "2026-04-29T10:00:00Z",
  "updated_at": "2026-04-29T10:00:13Z",
  "transcript": "assistant: Hello\nuser: hi",
  "telephony_data": {
    "call_type": "inbound",
    "from_number": "+919999900000",
    "to_number": "+918000000000",
    "recording_url": "https://example.com/rec.mp3"
  },
  "extracted_data": {
    "lead_data": {
      "business_slug": { "subjective": "acme-motors", "confidence": 1 },
      "name":          { "subjective": "Neem",        "confidence": 0.6 },
      "product":       { "subjective": "Honda Dio",   "confidence": 0.8 },
      "lead_intent":   { "objective":  "Warm",        "confidence": 0.7 },
      "connect_on_whatsapp": { "subjective": "true",  "confidence": 0.9 },
      "actionable":    { "subjective": "Send brochure on WhatsApp" }
    }
  }
}
'@

Invoke-RestMethod `
  -Uri "http://localhost:3000/api/webhooks/bolna/leads?secret=$env:BOLNA_WEBHOOK_SECRET" `
  -Method POST -ContentType "application/json" -Body $body
```

Bash:

```bash
curl -X POST http://localhost:3000/api/webhooks/bolna/leads \
  -H "Content-Type: application/json" \
  -H "x-bolna-signature: $BOLNA_WEBHOOK_SECRET" \
  -d @inbound-test.json
```

Expected: `200 { id: "<lead uuid>" }`. Lead appears at `/leads`, call appears at `/conversations`.

### Test outbound end-to-end

1. **Configure** the agent's post-call webhook to `…/api/webhooks/bolna/leads?secret=…` in the Bolna dashboard.
2. **Pick a lead** with a phone number at `/leads`.
3. **Click the phone icon** on the lead row. A row appears in `public.calls` with `status = 'initiated'` and a `bolna_call_id`.
4. **Wait** for the call to complete. After Bolna fires the final `completed` event you should see:

   ```
   [bolna webhook] POST received
   [outbound] updating call { callId, externalId, status: 'completed', durationSeconds, hasTranscript: true, hasRecording: true }
   POST /api/webhooks/bolna/leads ... 200 in ...
   ```

5. The conversations page now shows the row as **Completed** with duration, **Audio → Play** linking the recording, and the transcript dialog populated when you click the row.

If you see `[outbound] no matching call for execution …` — that means we don't have a call with that `bolna_call_id`. Most often the agent fired the webhook for a call we didn't initiate (manual test from the Bolna dashboard, calls placed against a different env, etc.).

---

## Campaigns (Bulk Outbound)

Files:
- Action: [src/actions/campaigns.ts](../src/actions/campaigns.ts)
- Validation: [src/lib/validations/campaign.ts](../src/lib/validations/campaign.ts)
- Type: [src/types/campaign.ts](../src/types/campaign.ts)
- Client CSV parser: [src/lib/campaigns/csv-parse.ts](../src/lib/campaigns/csv-parse.ts) (PapaParse wrapper)
- Webhook post-step: [src/lib/campaigns/outcome.ts](../src/lib/campaigns/outcome.ts)
- Cron drainer: [src/app/api/cron/campaigns/tick/route.ts](../src/app/api/cron/campaigns/tick/route.ts)
- Results CSV export: [src/app/api/campaigns/[id]/export/route.ts](../src/app/api/campaigns/[id]/export/route.ts)
- Dispatcher (rotation + caps): [src/lib/campaigns/dispatch.ts](../src/lib/campaigns/dispatch.ts)
- UI: [src/app/(app)/campaigns/page.tsx](../src/app/(app)/campaigns/page.tsx), [src/components/app/campaign-upload-dialog.tsx](../src/components/app/campaign-upload-dialog.tsx), [src/components/app/campaigns-table.tsx](../src/components/app/campaigns-table.tsx)
- Per-campaign detail (Performance + Calls tabs): [src/app/(app)/campaigns/[id]/page.tsx](../src/app/(app)/campaigns/[id]/page.tsx), [src/components/app/campaign-performance.tsx](../src/components/app/campaign-performance.tsx)

A campaign is a CSV upload of phone numbers + a retry config. Skelo dials each contact through the org's existing voice agent (the same `initiateBolnaCall` primitive used by single-lead dials), and re-arms failures up to a user-set cap.

### Live tables

`public.campaigns` (one row per uploaded batch, tenant-scoped by `organisation_id`):

```
id, organisation_id, created_by,
name, file_name,
agent_id,                                -- nullable; falls back to bolna_integrations.agent_id
status (text check:
  draft | scheduled | in_progress | paused | stopped | completed | failed),
scheduled_at,                            -- when "Schedule" was picked; null = run-now
started_at, completed_at,

-- Retry config (snapshot at upload, immutable for the batch):
max_attempts (smallint, 1..10),          -- 1 initial + up to 9 retries (technical)
max_callbacks (smallint, 0..5, default 2),-- customer-requested callbacks honored
                                          --   per contact, SEPARATE from max_attempts
retry_interval_seconds (int, 60..86400),
retry_on (text[], subset of { no_answer, busy, failed, canceled }),  -- TECHNICAL triggers only
switch_connect_rate_floor (smallint, 0..100, default 30),  -- caller-ID switching
switch_window_minutes (int, 5..1440, default 60),
switch_min_samples (smallint, 1..1000, default 20),

-- Denormalized counters maintained by AFTER trigger on campaign_contacts:
total_contacts, valid_contacts,
succeeded_count, failed_count, in_flight_count,

created_at, updated_at
```

`public.campaign_contacts` (one row per CSV phone; lifecycle pending → in_flight → succeeded/failed/skipped):

```
id, campaign_id, organisation_id,
raw_phone,                               -- as uploaded (e.g. "+91-99999 00000")
phone,                                   -- digits only, dedupe key (5..32)
name, metadata (jsonb),                  -- extra CSV columns → passed to Bolna user_data
status (text check:
  pending | in_flight | succeeded | failed | skipped),
attempt (smallint, default 0),          -- every dial; gated by max_attempts + callback_count
callback_count (smallint, default 0),   -- honored callbacks; each grants one extra dial
health_defer_count (smallint, default 0),-- all-numbers-resting deferrals (backoff → least-bad)
next_attempt_at,
last_call_id (uuid → calls.id),
last_status,                             -- TECHNICAL status of the last call
last_outcome,                           -- SEMANTIC disposition of the last call (mirrors calls.call_outcome)
last_error,
lead_id,                                 -- filled in by webhook post-step on first successful call
created_at, updated_at
```

`public.calls.call_outcome` (text, nullable — **no fixed vocabulary**; resolved per-org against `org_outcome_policies`) + `public.calls.requested_callback_at` (timestamptz, nullable) — the per-conversation **disposition** the voice agent extracted (what the customer wanted) and the time they asked to be re-called. These drive disposition-based retry; see *Campaign post-step* below.

`public.calls.campaign_contact_id` (uuid, nullable, FK to `campaign_contacts.id` on delete set null) — the seam between the existing dial pipeline and a campaign run. The Bolna webhook reads it after every status update to drive the campaign-contact state machine.

### CSV format (uploaded by users)

The upload dialog parses the file in the browser with PapaParse before sending anything to the server.

- **Required column:** `phone` — header detection accepts case-insensitive matches for `phone`, `mobile`, `number`, `msisdn`, `contact`. The dialog tells the user which header it picked.
- **Optional column:** `name` — also matches `full_name`, `fullname`, `contact_name`.
- **Any other columns** are stored on `campaign_contacts.metadata` and passed through to the voice agent as `user_data` for prompt personalization (`{{vehicle}}`, `{{interest}}`, etc.).
- **Row validation:** `normalisePhoneForWa()` strips non-digits; rows with 7–15 digits after normalization are kept. Duplicates within the file (same normalized number) are skipped — the first wins. The dialog reports `valid / total` and `duplicates skipped` before the user confirms.
- **Encoding:** UTF-8. A BOM is fine. Comma-separated; quote any field containing commas, quotes, CR, or LF (RFC 4180).

**Sample CSV** — minimum viable:

```csv
phone,name
+91 99999 00000,Neem Kumar
9810000111,Priya Sharma
+1 (415) 555-0199,Alex Patel
```

**Sample CSV** — with extra columns the agent uses for context:

```csv
phone,name,vehicle,city,last_visit
+91 99999 00000,Neem Kumar,Honda Dio,Bengaluru,2026-04-22
9810000111,Priya Sharma,Royal Enfield Classic 350,Pune,
+1 (415) 555-0199,Alex Patel,Tesla Model 3,San Francisco,2026-04-30
```

In the second sample, `vehicle`, `city`, and `last_visit` are merged into `campaign_contacts.metadata` and forwarded as `user_data.vehicle` / etc. on the Bolna `POST /call` payload — the agent prompt template can interpolate them.

### `createCampaign(input)`

**Input** (validated by `createCampaignSchema`):

```ts
{
  organisation_id: string;                          // uuid
  name: string;                                     // 1..200
  file_name?: string | null;
  schedule_mode: "now" | "later";
  scheduled_at?: string | null;                     // ISO datetime, required when schedule_mode === "later"
  agent_id?: string | null;                         // optional per-campaign agent; falls back to org default
  from_phone_number?: string | null;                // single caller-ID override (set when exactly one number is chosen)
  from_phone_numbers?: string[];                    // caller-ID rotation pool (0..50); each must be a saved workspace number
  max_attempts: number;                             // 1..10 (slider 0..9 retries → +1)
  retry_interval_seconds: number;                   // 60..86400
  retry_on: ("no_answer" | "busy" | "failed" | "canceled")[];
  switch_connect_rate_floor?: number;               // 0..100, default 30 — connect-rate switching floor
  switch_window_minutes?: number;                   // 5..1440, default 60 — switching window
  switch_min_samples?: number;                      // 1..1000, default 20 — min dials before judging
  contacts: Array<{
    raw_phone: string;
    phone: string;                                  // digits only
    name?: string | null;
    metadata?: Record<string, unknown>;
  }>;                                               // 1..10000
}
```

**Returns** `ActionResult<Campaign>`.

**Flow:**
1. `userOwnsOrg()` gate.
2. Reject if `bolna_integrations` is missing or `enabled = false` for the org — saves us from creating a campaign that can never dial.
3. Insert `campaigns` row (status `in_progress` if run-now, else `scheduled`).
4. Bulk-insert `campaign_contacts` with `next_attempt_at = now()` (run-now) or `= scheduled_at` (schedule-later).
5. Trigger fires → counters populate.
6. The cron drainer picks contacts up on the next minute tick. For run-now, the row is already due; for schedule-later, the cron promotes the campaign from `scheduled` → `in_progress` once `scheduled_at <= now()`.

If contact insert fails, the action rolls back the parent `campaigns` row so the user isn't left with an empty shell.

### `runCampaignNow(input)`

**Input** `{ id: string }` (uuid).
**Returns** `ActionResult<Campaign>`.

Flips a `scheduled` / `paused` / `stopped` / `completed` campaign back to `in_progress`, re-arms still-pending contacts (`next_attempt_at = now()`), and clears `completed_at`. Refuses on a campaign already in `in_progress`.

### `stopCampaign(input)`

**Input** `{ id: string }`. **Returns** `ActionResult<Campaign>`.

Marks every still-`pending` contact as `skipped` and flips the campaign to `stopped`. **In-flight calls are left alone** — their webhook will resolve them naturally; the trigger will flip the campaign to `completed` once nothing remains pending or in-flight.

### `deleteCampaign(input)`

Hard-deletes the `campaigns` row. FK cascade drops `campaign_contacts`; `calls.campaign_contact_id` becomes `null` (call history is preserved on the `calls` table).

### `listCampaigns(input)`

**Input**

```ts
{
  organisation_id: string;
  limit?: number;     // 1..100, default 20
  offset?: number;
  status?: CampaignStatus;
}
```

**Returns** `ActionResult<{ items: CampaignListItem[]; total: number }>`. Ordered `created_at desc`. `CampaignListItem` is `Campaign` plus a derived `best_disposition: string | null` — the campaign's **best disposition** (see *Best disposition* below), computed on read from the org's outcome priority. Powers the **Best disposition** column on the campaigns list.

### `getCampaignCalls(input)`

**Input** `{ id: string }`. **Returns** `ActionResult<CampaignCallRow[]>`.

Drives the call-log sheet. Joins `calls` to the contact via `campaign_contact_id`, returning the recipient phone, attempt number, status, duration, recording URL, and any error message. Ordered `started_at desc` — newest call first across all attempts.

### `POST /api/cron/campaigns/tick`

The drainer. Called every minute by `pg_cron` via `pg_net.http_post` (see [the cron migration](../supabase/migrations/20260508000001_campaigns_cron.sql)).

**Auth:** header `x-cron-secret` must equal `process.env.CRON_SECRET`. The Postgres function reads the same secret from Supabase Vault.

**Per tick:**
0. **Self-heal** (`reconcileStuckCampaigns`): time out contacts stuck `in_flight` past 30 min with no result webhook (→ `failed`), and close out any `in_progress` campaign that has no `pending`/`in_flight` contacts left (→ `completed`). This keeps status/progress truthful even when a result webhook is lost.
1. Promote any `scheduled` campaigns whose `scheduled_at` has passed → `in_progress`.
2. Select up to **250** due contacts globally (`BATCH_LIMIT`), capped at **100 per campaign** (`PER_CAMPAIGN_LIMIT`) so one large campaign can't starve smaller batches behind it. Dials run with up to **25** concurrent provider requests (`CONCURRENCY`). These are per-tick (≈ per-minute) ceilings; sustained volume is ultimately bounded by the caller-ID pool × daily cap (capped numbers defer), not by these values.
3. **Pick a caller-ID** for each dial by connect-rate health (see *Caller-ID switching* below). If every number is resting, the contact is **deferred** with escalating backoff; after a few rounds the dispatcher dials from the least-bad number so the run finishes.
4. Optimistic CAS (`update ... where status='pending'`) to claim → fire `initiateBolnaCall` from the chosen number → insert a `calls` row with `campaign_contact_id` + `from_phone` set → patch the contact (`attempt++`, `last_call_id`, leave `status` at `in_flight`).
5. Bolna failures get a `calls` row inserted with `status='failed'` for visibility, and the contact is either re-armed for another attempt or marked `failed` if the cap is hit.

The Bolna webhook ([src/app/api/webhooks/bolna/calls/route.ts](../src/app/api/webhooks/bolna/calls/route.ts)) handles the rest — see the **Campaign post-step** subsection below.

### Caller-ID switching (connect-rate based)

Carriers flag a number that gets too many calls; the symptom is a **falling connect rate** (people stop answering a "spam likely" number). Rather than a fixed daily count, the dispatcher watches each number's connect rate over a rolling window and rests any number whose rate falls below the campaign's floor. (Replaces the old `daily_calls_per_number` cap, which is now dormant — a fixed count doesn't map to when different numbers actually get flagged.)

Per-campaign knobs (set on upload, defaults shown):
- `switch_connect_rate_floor` — **30**% min connect rate.
- `switch_window_minutes` — **60** min rolling window.
- `switch_min_samples` — **20** dials in the window before the rate is trusted.

Selection (`pickHealthyNumber` in [src/lib/campaigns/dispatch.ts](../src/lib/campaigns/dispatch.ts)):
- **Candidates**: `campaigns.from_phone_numbers[]` (pool), else the single override (`campaigns.from_phone_number` → `bolna_integrations.from_phone_number`), else none → dial with no caller-ID (provider's pool).
- A candidate is **eligible** if it has `< switch_min_samples` dials in the window (too few to judge → give it a chance) **or** its connect rate is `>= floor`.
- **Connect rate is computed over RESOLVED calls only** (`completed`/`no_answer`/`busy`/`failed`/`canceled` — see `RESOLVED_CALL_STATUSES`). In-flight dials (`initiated`/`ringing`/`in_progress`) have no connect verdict yet, so they're excluded from both the numerator and denominator. **This is critical:** counting them would make a fresh burst of dials read as ~0% connect rate (all dialed, none completed yet), rest every caller-ID, and throttle the campaign to a deferral crawl. Both `loadNumberCalls` (query filter) and `computeNumberHealth` (in-memory guard) enforce this.
- Among eligible numbers, pick the **least-loaded** (window dials + in-batch dials) to spread volume.
- **All resting** → `pickHealthyNumber` returns `defer`. The dispatcher pushes `next_attempt_at` out with exponential backoff (`30m × 2^round`) and bumps `campaign_contacts.health_defer_count`. Once `health_defer_count >= MAX_HEALTH_BACKOFF_ROUNDS` (3), it dials the **least-bad** (highest connect rate) number, flagged `degraded`. `health_defer_count` resets to 0 only on a healthy dial, so least-bad mode is sticky until a number recovers.
- Health is computed **org-wide** (a number's reputation spans the org) from recent `calls`, loaded once per tick over the longest window any campaign in the batch needs, then sliced per campaign window. Tenancy: rows are grouped by `organisation_id` so one org's volume never colours another's (Law #1).

The dashboard (`getCampaignStats`) shows each number's recent connect rate + a **resting** badge, and a **degraded** banner when every judged number is resting. (Dashboard health is campaign-scoped over the window; the dispatcher uses the org-wide view.) The recent-window rate here uses the **same resolved-only** rule as the dispatcher, so the dashboard can't mislabel a number as resting right after a burst.

#### Per-contact transparency (Performance tab → "Contacts")

`getCampaignStats` also returns a per-contact lifecycle view so a slow-looking run is self-explanatory — it answers *"why hasn't this contact been called yet?"*. Each contact is mapped to one `ContactState`:

| State | Meaning |
| --- | --- |
| `succeeded` / `failed` | Terminal. |
| `dialing` | `in_flight` right now. |
| `deferred` | Pending — every caller-ID is resting (in backoff). `nextAttemptLabel` shows when it retries. |
| `callback` | Pending — a customer-requested callback is scheduled (honours the requested time, which can be days out). |
| `retry` | Pending — waiting on the retry interval after a `no_answer`/`busy`/`failed`. |
| `queued` | Pending — never dialled yet. |

`contactStateCounts` is exact (covers every contact); `contacts` is the **200 most-actionable** rows (deferred → callback → retry → … ), with `contactsOverflow` for the remainder. `nextAttemptLabel` (`in 24m` / `in 2h` / `in 6d`) is computed server-side at fetch so the render stays pure.

Numbers are added/managed per org in **Manage agents & numbers** ([voice-config.ts](../src/actions/voice-config.ts) → `bolna_integrations.from_phone_numbers[]` + `from_phone_labels`). They're trusted as entered — Bolna only honors a `from_phone_number` that's a Bolna dedicated number or one on a connected Twilio/Plivo/SIP account; an unrecognized number surfaces Bolna's error on the failed dial.

### Campaign post-step (in the Bolna webhook)

When `calls.campaign_contact_id` is non-null, [src/lib/campaigns/outcome.ts](../src/lib/campaigns/outcome.ts) (`applyCampaignContactOutcome`) advances the contact. It decides on **two axes**: the *technical* `callStatus` and the *semantic* `call_outcome` (disposition). Every transition is guarded by `.eq('status','in_flight')`, so a duplicate webhook is a no-op.

**Technical tier** — connection-level statuses (`no_answer` / `busy` / `failed` / `canceled`), resolved from the status-only webhook path:

- Status in `retry_on` AND `attempt < max_attempts + callback_count` → contact `pending`, `next_attempt_at = now() + retry_interval_seconds`.
- Status in `retry_on` but dial cap hit, OR a status not in `retry_on` → contact `failed`.
- Non-terminal status (`ringing`, `in_progress`) → no-op.

**Disposition tier** — applies to `completed` calls only. The disposition lives **only in the extracted_data payload**, so the status-only path *defers* `completed` to `recordOutboundResult` (the final extracted webhook), which calls the engine with `call_outcome` + `requested_callback_at`. (If that final event never lands, the 30-min in-flight reconcile sweeps the contact to `failed`.)

The outcome → action mapping is **per-org and admin-configurable** (`org_outcome_policies`; see *Configurable outcome policy* below). The applier loads the org's policy and the pure `decideOutcome` resolves the action:

| policy `action` | what the contact does |
| --- | --- |
| `succeed` | contact `succeeded` (+ lead conversion) |
| `fail` | contact `failed`, no retry (`last_error = "Outcome: <key>"`) |
| `callback` (budget left) | contact `pending`, `next_attempt_at = requested_callback_at` (falls back to `retry_interval` if missing/past), `callback_count++` |
| `callback` (budget exhausted) | contact `succeeded` (+ lead conversion) |
| `retry` (under cap) | contact `pending`, `next_attempt_at = now + retry_interval` |
| `retry` (cap hit) | contact `failed` (`last_error = "Retries exhausted (<key>)"`) |

A `completed` call whose label isn't in the org's policy (or has none extracted) resolves to the **fallback** (`no_decision`, action `succeed` by default). The seeded defaults reproduce the old hardcoded behaviour exactly (`interested`/`meeting_booked` → succeed, `not_interested`/`do_not_call`/`wrong_number` → fail, `callback_requested` → callback, `no_decision` → succeed/fallback).

**Lead conversion** (on any `succeed`): look up an existing lead in the org by exact `phone`; if absent, insert a new `leads` row (`source = 'manual'`, `status = 'contacted'`, name carried from the CSV). Cache the resulting `lead_id` on the contact.

**Budgets are independent.** `attempt` (every dial) is capped by `max_attempts`; honored callbacks spend `callback_count` (capped by `max_callbacks`) and each grants **one extra dial** (the dispatch gate is `attempt < max_attempts + callback_count`), so a genuine "call me next week" is never starved by earlier no-answers.

#### Configurable outcome policy (`org_outcome_policies`)

Per org, one row per outcome: `outcome_key` (the normalised label the agent emits), `label`, `action` (`succeed`/`fail`/`callback`/`retry`), `counts_as_success` (drives the campaign success rate, **decoupled** from `action`), `position`, `is_fallback`.

- **Custom outcomes are allowed** — admins add/rename their own keys (e.g. `demo_scheduled`). Because of that, `calls.call_outcome` has **no fixed-vocabulary CHECK** (dropped in `20260610000000`); the value is stored verbatim and resolved against the policy at decision time. `coerceCallOutcome()` only normalises (trim/lowercase/underscore) + maps the standard aliases; unknown keys pass through.
- **The agent must emit these exact keys.** There's no provider signal to keep them in sync, so the admin UI (`/admin/organisations/[id]/outcomes`) surfaces the key list to paste into the agent's extraction prompt. Drift → the label resolves to the fallback.
- **`no_decision` is the reserved, non-deletable fallback.** Any label not in the policy resolves to it.
- **Seeding** (`seed_default_outcome_policies`) fires on org insert + a backfill, so existing orgs keep today's behaviour. Edited via `actions/admin/outcome-policies.ts` (requireAdmin, service-role).
- **Success rate** (`getCampaignStats`) counts contacts whose `last_outcome` maps to `counts_as_success` — but **gated on the call having connected** (`last_status = 'completed'`), so a never-connected contact can't count via the fallback and the funnel stays monotonic (`succeeded ⊆ connected`).
- **`position` is the outcome PRIORITY** (ascending = higher priority), set by the admin on `/admin/organisations/[id]/outcomes` via the **click-to-rank** control (`reorderOutcomePolicies` reassigns gap-free positions `0..n`; `is_fallback` never ranks). The same order drives the **Best disposition** feature below and the Calls-tab outcome dropdown order.

The campaign trigger keeps the parent counters in sync and auto-flips the campaign to `completed` once nothing remains pending or in-flight.

#### Best disposition (`campaign_best_dispositions`)

The single highest-priority outcome reached, shown per campaign (campaigns list) and per contact (campaign Calls tab). Logic lives in the pure [src/lib/campaigns/best-disposition.ts](../src/lib/campaigns/best-disposition.ts) (`buildOutcomeRanking` → top-`TOP_DISPOSITION_PRIORITIES` (5) `outcome_key → rank` map, excluding the fallback; `pickBestOutcome` → the lowest-rank key that occurred, or `null`). Loaded via [src/lib/queries/outcome-ranking.ts](../src/lib/queries/outcome-ranking.ts) (`loadOutcomeRanking`, RLS-scoped read of `org_outcome_policies`).

- **Per campaign** (`listCampaigns`): the `campaign_best_dispositions(p_org_id, p_campaign_ids[])` RPC (migration `20260624000000`, `security definer`, org-bounded) returns the distinct `(campaign_id, outcome_key)` set that occurred (joining `calls → campaign_contacts`, excluding `is_test`); the action ranks it per campaign → `best_disposition`.
- **Per contact** (`listConversations`, campaign-scoped only): a bounded follow-up query over the page's contacts' calls → best per contact → `best_outcome` on each row.
- **Compute-on-read** (no denormalized column) so reordering outcome priority can never leave a stale value. Outcomes ranked **below the top 5**, the fallback, or contacts/campaigns with no qualifying outcome render as `—`.

### `GET /api/campaigns/[id]/export`

Session-authed. Generates a **per-call** CSV on demand (one row per dial across all attempts, joined from `calls` → `campaign_contacts`) — no original file is stored. Verifies the campaign belongs to the caller's org before returning.

**Columns:** Phone, Name, Attempt, Outcome, Direction, Started At, Answered At, Ended At, Duration (s), Error. Recording URLs are deliberately omitted (signed links that need no login — same omission as `/api/leads/export`).

Reuses the shared CSV helper at [src/lib/csv.ts](../src/lib/csv.ts) (`csvEscape` + `toCsv` + `withBom`).

**Responses**

| Status | Body |
| --- | --- |
| `200` | `text/csv; charset=utf-8` — `Content-Disposition: attachment; filename="skelo-campaign-<safe-name>-<YYYY-MM-DD>.csv"` |
| `400` | `{ error: "Invalid campaign id" }` |
| `403` | `{ error: "Forbidden" }` |
| `404` | `{ error: "Not found" }` |
| `500` | `{ error: "<supabase message>" }` |

### Operational setup

After applying both campaigns migrations:

1. **Enable extensions** in the Supabase dashboard — `pg_cron` and `pg_net`. Vault is on by default.
2. **Store the cron URL + secret in Vault**, in the SQL editor:

   ```sql
   select vault.create_secret(
     'https://<your-deploy>/api/cron/campaigns/tick',
     'campaigns_cron_target_url'
   );
   select vault.create_secret(
     '<long random string>',
     'campaigns_cron_secret'
   );
   ```

   The `alter database … set` GUC approach won't work on Supabase hosted (requires superuser).

3. **Mirror the secret** in Next.js as `CRON_SECRET=<long random string>` (same value).
4. **Verify the schedule:** `select jobid, schedule, jobname, active from cron.job where jobname = 'campaign-tick';` — one active row, schedule `* * * * *`.
5. **Verify the secrets:** `select name from vault.secrets where name like 'campaigns_cron%';` — two rows.

For local dev without cron, trigger the drainer manually:

```bash
curl -X POST http://localhost:3000/api/cron/campaigns/tick \
  -H "x-cron-secret: $CRON_SECRET"
```

### Realtime

`useCampaignsRealtime(orgId)` ([src/hooks/use-campaigns-realtime.ts](../src/hooks/use-campaigns-realtime.ts)) subscribes to `public.campaigns` AND `public.campaign_contacts` filtered by `organisation_id=eq.<id>`, with the same 350 ms debounced `router.refresh()` pattern as `useCallsRealtime`. Both tables must be in the `supabase_realtime` publication — the schema migration adds them.

---

## Realtime

Two client hooks subscribe to Supabase Postgres CHANGES so the UI auto-refreshes without a manual reload:

| Hook | File | Subscribed table | Filter | Used by |
| --- | --- | --- | --- | --- |
| `useLeadsRealtime(orgSlug)` | [src/hooks/use-leads-realtime.ts](../src/hooks/use-leads-realtime.ts) | `public.leads` | `org_slug=eq.<slug>` | `LeadsTable` |
| `useCallsRealtime(orgId)` | [src/hooks/use-calls-realtime.ts](../src/hooks/use-calls-realtime.ts) | `public.calls` | `organisation_id=eq.<id>` | `ConversationsTable` |
| `useCampaignsRealtime(orgId)` | [src/hooks/use-campaigns-realtime.ts](../src/hooks/use-campaigns-realtime.ts) | `public.campaigns` + `public.campaign_contacts` | `organisation_id=eq.<id>` | `CampaignsTable` |

Both hooks debounce events by 350 ms and call `router.refresh()` on the trailing edge — the existing server-side filter / sort / pagination stay authoritative; we just re-render. Burst inserts (CSV imports, status-transition fan-out) coalesce into a single round-trip.

> **Realtime publication.** Both tables must be in the `supabase_realtime` publication. Verify with `select * from pg_publication_tables where pubname = 'supabase_realtime';`. Add a missing one with `alter publication supabase_realtime add table public.calls;` (or via the Supabase dashboard). RLS still gates which events the client receives — the channel filter is a performance hint, not a security boundary.

---

## Analytics

File: [src/lib/analytics/dashboard.ts](../src/lib/analytics/dashboard.ts) (server-only). Consumed by `/dashboard`.

### `getDashboardAnalytics({ orgSlug, orgId, range })`

Pulls `2 × range` of `leads` and `calls` (so current + previous windows come from the same fetch, capped at 10k each), then derives in memory:

- **KPI cards:** total calls, unique callers (distinct `calls.to_phone`), avg completed-call duration, qualified-lead rate (% of new leads with `lead_intent IN (hot, warm)`), each with a "vs. previous period" delta.
- **Daily series:** new leads per day (UTC buckets) — feeds the Daily New Leads bar chart.
- **Temperature distribution:** daily Hot/Warm/Cold stacks + totals — feeds the Lead Temperature chart.
- **Product interest:** top 6 products by lead count within the window + grand total of mentions.
- **Call outcomes:** distribution across call `status` values.

`range` is one of `24h | 7d | 14d | 30d`; `parseRange()` normalises URL input and defaults to `14d`. See [`RangeToggle`](../src/components/app/analytics/range-toggle.tsx) for the UI that writes the `?range=` param.

Implementation note: we trade accuracy beyond the 10k cap for single-query latency. If an org routinely creates more than that in 60 days, move this to SQL aggregation (window function) and revisit.

---

## Admin Console

Files:
- Gate: [src/lib/auth/admin.ts](../src/lib/auth/admin.ts) — `requireAdmin()` (redirecting) + `getIsAdmin()` (non-redirecting read).
- Actions: [src/actions/admin/organisations.ts](../src/actions/admin/organisations.ts), [src/actions/admin/voice-agent.ts](../src/actions/admin/voice-agent.ts), [src/actions/admin/users.ts](../src/actions/admin/users.ts).
- Type: [src/types/profile.ts](../src/types/profile.ts).
- UI: `(admin)/` route group — see [sitemap.md](sitemap.md).

### Design

The admin panel is for **Skelo staff** (not org owners). All admin Server Actions run through the **service-role client** (`createAdminClient()`), bypassing RLS, and are gated at the top by `requireAdmin()`. Every gate is checked on both the route layout and the action itself — defense in depth. Owners lose the ability to configure the voice agent; that moved here entirely. Settings now renders a read-only `VoiceAgentStatusCard`.

### `requireAdmin()`

Returns `{ userId, email }` on success. Redirects:

- no auth user → `/login`
- user is not an admin → `/dashboard` (no enumeration signal)
- user is an admin → returns, **regardless of whether they own an organisation**. Admins are typically org-less Skelo staff.

### Organisation management — `src/actions/admin/organisations.ts`

| Action | Input | Returns |
| --- | --- | --- |
| `listAllOrganisations` | `{ q?, limit?, offset? }` (defaults 100/0) | `{ items: AdminOrganisationRow[], total }` — joins owner email (via `auth.admin.listUsers`), voice agent status, lead count |
| `getOrganisationAdmin` | `string` (uuid) | full `AdminOrganisationRow` or `"Organisation not found"` |
| `updateOrganisationAdmin` | `{ id, name?, slug? }` | updated `Organisation`. Empty patches rejected. Slug must pass `^[a-z0-9]+(?:-[a-z0-9]+)*$`. |

`AdminOrganisationRow` adds `owner_email`, `voice_agent_connected`, `voice_agent_enabled`, `voice_agent_connected_at`, `lead_count` on top of the plain `Organisation` row. Slug rename cascades to `leads.org_slug` via the existing FK — the UI wraps slug editing behind an explicit "Edit slug" unlock + confirm to prevent casual renames.

### Voice agent provisioning — `src/actions/admin/voice-agent.ts`

Mirrors the per-org integration shape but gated by `requireAdmin()` (not `userOwnsOrg`):

| Action | Input | Effect |
| --- | --- | --- |
| `getVoiceAgentAdmin` | `organisationId` (uuid) | returns `BolnaIntegration` (with `api_key_last4`; `daily_calls_per_number` is dormant) or null |
| `upsertVoiceAgentAdmin` | `{ organisation_id, agent_id, api_key, from_phone_number?, enabled }` | creates or replaces the integration |
| `updateVoiceAgentAdmin` | partial upsert shape | patches agent id / key / caller id / **daily call cap** / enabled |
| `disconnectVoiceAgentAdmin` | `organisationId` | deletes the integration row — outbound calls fail with "Voice agent not configured" until re-added |

Each mutation revalidates `/admin/organisations`, `/admin/organisations/[id]`, `/settings`, `/dashboard`, and `/pulse` so owner-visible state updates immediately.

### User management — `src/actions/admin/users.ts`

| Action | Input | Effect |
| --- | --- | --- |
| `listAllUsers` | — | joins `auth.admin.listUsers` with `profiles` to return `{ id, email, display_name, is_admin, created_at }[]` ordered newest first |
| `setUserAdmin` | `{ user_id, is_admin }` | flips the flag via the service-role client. **Self-demotion is blocked** to avoid lockouts — another admin must do it. |

Promotion bypasses the RLS `WITH CHECK` on `profiles` because it uses the service-role client; that's the only intended path for flipping `is_admin`.

### Bootstrapping the first admin

After applying `20260424000002_profiles_and_admin.sql`, run once in the Supabase SQL editor:

```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'you@example.com');
```

Sign out and sign back in — the login action reads the flag and redirects to `/admin`. From then on, promote additional admins from `/admin/users`.

---

## Security Model

**Layered defense:**

1. **Session** — Middleware refreshes the Supabase session on every request ([src/middleware.ts](../src/middleware.ts)). Actions call `auth.getUser()` at the top.
2. **App-layer tenant check** — `userOwnsOrg(user, orgId)` gates every mutation. The action filters by `organisation_id` even if RLS would block.
3. **RLS policies** — Every tenant-scoped table has `select/insert/update/delete` policies tied to `organisations.owner_id = auth.uid()`. Safety net only.
4. **Service role** — Reserved for trusted server paths (webhook). Never imported into a Client Component.
5. **Webhook signature** — Constant-time compare of a shared secret. Never trust tenant ids from the payload — resolve server-side from the trusted `agent_id` via the `voice_agents` registry (`resolve_org_by_agent`), with a dialed-number (DID) fallback. This replaced the old LLM-emitted `business_slug` routing.
6. **Input validation** — Zod at every boundary. No `any`, no `@ts-ignore`.

**Things a future reviewer should check:**

- No Server Action should ever pull `organisation_id` straight from client input without a `userOwnsOrg` gate.
- No `SELECT *` on hot paths — use an explicit column list (see `LEAD_LIST_COLUMNS`).
- Any new table must get RLS enabled **and** explicit policies. A table with RLS on and zero policies = empty to everyone.
