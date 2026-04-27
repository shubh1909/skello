# Skello Backend API Reference

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
12. [Analytics](#analytics)
13. [Admin Console](#admin-console)
14. [Security Model](#security-model)

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
```

> Provider **API keys** are **per-organisation** — stored in the `bolna_integrations` table and configured by each org admin in Settings. Skello itself does not hold a global provider key. The environment variable names above still reference `BOLNA_*` because that is the current provider; rename if you later abstract the service directory.

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

Migrations:
- `20260420000000_create_organisations.sql`
- `20260420000001_create_leads.sql`
- `20260420000002_leads_contacted_on_whatsapp.sql`
- `20260420000003_create_reminders.sql`
- `20260420000004_leads_schema_fixes.sql`
- `20260421000000_leads_add_phone.sql` — adds nullable `phone` column + `(org_slug, phone)` partial index. Required for the WhatsApp dialog.
- `20260421000001_leads_rls_policies.sql` — enables RLS + policies on `leads`.
- `20260422000000_bolna_integrations_and_calls.sql` — per-org voice agent config (service-role only) and outbound `calls` table. Required for the outbound dialler.
- `20260422000001_leads_external_id_full_unique.sql` — replaces the partial unique index on `(org_slug, external_id)` with a full one so the inbound-lead webhook's `onConflict` upsert works.
- `20260424000000_leads_add_crm_fields.sql` — enums `lead_source`, `lead_status`; columns `source`, `status` (NOT NULL default `'new'`), `notes`, `city`, `pincode`; composite indexes on `(org_slug, status)` and `(org_slug, source)`; backfills `source` to `inbound_call` when `external_id IS NOT NULL`, else `manual`.
- `20260424000001_calls_direction_and_transcripts.sql` — enums `call_direction`, `call_transcript_status`, `call_turn_speaker`; `calls` gains `direction` (NOT NULL default `'outbound'`), `transcript`, `transcript_status`, `transcript_fetched_at`, `language`; `calls.to_phone` becomes nullable; new child table `call_transcripts` (one row per utterance) with RLS + FTS GIN index on `to_tsvector('simple', text)`.
- `20260424000002_profiles_and_admin.sql` — new `profiles` table (one row per `auth.users` id) with `display_name` + `is_admin`; trigger `on_auth_user_created` auto-provisions profile rows on signup; backfills existing users; RLS lets a user read & update their own profile **except** `is_admin` (locked via `WITH CHECK`). Admin promotion goes through the service-role client.
- `20260427000000_leads_rename_columns_and_summary.sql` — renames `leads.product` → `interest`; adds `summary text`; renames `contacted_on_watsapp` → `pending_action` and inverts the semantics (true = action still owed) with a default of `true`. Existing rows are flipped (`old true` → `false`, `old false/null` → `true`). The Status column was hidden from the leads table UI in the same change; the column itself is unchanged.

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

```
id, created_at, updated_at, org_slug, external_id,
name, interest,                          -- renamed from `product` on 2026-04-27
summary,                                 -- short LLM synopsis (added 2026-04-27)
lead_intent (enum: hot | warm | cold),   -- Postgres enum `intent_type`
visit_date_time, customer_status,        -- customer_status = free-form
                                         --   "buyer type" label
phone,                        -- nullable; consumed by the WhatsApp dialog
wants_to_connect_on_watsapp,  -- from the voice agent: what the customer wants
pending_action,               -- NOT NULL DEFAULT true. Renamed from
                              --   `contacted_on_watsapp` on 2026-04-27 with
                              --   inverted semantics — true means an action
                              --   is still owed by the team.

-- Added 2026-04-24 (20260424000000_leads_add_crm_fields.sql):
source   (enum lead_source:
   inbound_call | whatsapp | manual | import | web_form),
status   (enum lead_status:
   new | contacted | qualified | negotiating | won | lost)
         NOT NULL DEFAULT 'new',
notes,
city,
pincode
```

Tenant scoping on `leads` is via **`org_slug` (text)**, enforced by FK `leads.org_slug → organisations.slug` (cascade on update/delete). All actions also gate on the caller owning that org.

**Two "status" columns, deliberately distinct:**

- `status` — the **pipeline stage** enum (new → contacted → qualified → negotiating → won/lost). The column is still authoritative on the server, but **as of 2026-04-27 the leads table no longer renders it** — it was hidden from the table UI to reduce visual noise alongside the new pending-action chip. The detail sheet still surfaces it (as a Badge and an editable Select), and `listLeads` still accepts `status` as a filter input so deep links and programmatic callers continue to work.
- `customer_status` — a **free-form** label the team uses for buyer type ("Buyer", "Owner", "Service", etc). Editable as an Input in the detail sheet, labelled **Customer type** in the UI.

`lead_intent` (hot/warm/cold) is a **temperature**, independent of both above — a "hot" lead can be `new` or `qualified` or `lost`.

**Idempotency**: `external_id` + unique index `(org_slug, external_id) where external_id is not null` allows inbound-webhook retries to be safely upserted without creating duplicates.

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
}
```

`LeadCreateDialog` stamps `source: "manual"` implicitly for anything captured through the UI; the inbound webhook stamps `source: "inbound_call"`.

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
| `200` | `text/csv; charset=utf-8` — `Content-Disposition: attachment; filename="skello-leads-<range>-<YYYY-MM-DD>.csv"` |
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

### `getBolnaIntegration(organisationId)`

**Input** `string` (uuid) — must belong to the caller's owned org.
**Returns** `ActionResult<BolnaIntegration | null>` — `null` if the org has not configured Bolna yet.

### `upsertBolnaIntegration(input)`

**Input**
```ts
{
  organisation_id: string;
  agent_id: string;                 // 1–200 chars, from Bolna dashboard
  api_key: string;                  // 1–500 chars, stored server-only
  from_phone_number?: string | null;// optional caller ID, 5–32 chars
  enabled?: boolean;                // default true
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

1. Log into Skello as an org owner.
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

created_at, updated_at
```

**Idempotency:** unique index `(organisation_id, bolna_call_id) where bolna_call_id is not null`. Both the inbound and outbound webhook paths upsert on this key.

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
  limit?: number;                       // 1–200, default 50
  offset?: number;                      // default 0
  lead_id?: string;                     // filter to a single lead
  status?: CallStatus;                  // "initiated" | "ringing" | "in_progress"
                                        // | "completed" | "failed" | "no_answer"
                                        // | "busy" | "canceled"
}
```
Returns `ActionResult<{ items: Call[]; total: number }>`, ordered by `started_at desc`. Each `Call` carries the full column set, including `direction`, `transcript`, and `transcript_status`.

### UI trigger

The leads table ([src/components/app/leads-table.tsx](../src/components/app/leads-table.tsx)) renders a **phone icon button** per row. Clicking it calls `initiateCall({ lead_id })`; the button is disabled when the lead has no phone. Call-history rows in the lead detail sheet show a direction glyph (↙ inbound / ↗ outbound) and expose a "View transcript" action when `transcript_status = 'ready'`.

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

### Enrichment entry points

`src/lib/bolna/enrich.ts` exposes two helpers. Both:
- Resolve the org's API key, skip cleanly if the integration is missing or disabled.
- Fetch `GET /executions/{id}` with bounded retries (0s, 0.8s, 2s) because the provider is eventually consistent.
- Upsert the `calls` row, then `DELETE FROM call_transcripts WHERE call_id = …` and bulk-insert parsed turns.
- Never throw — logged failures mark `transcript_status = 'failed'`.

| Function | Caller | Behavior |
| --- | --- | --- |
| `enrichInboundLead({ organisationId, leadId, orgSlug, executionId })` | Inbound lead webhook (via `after()`) | Upserts the `calls` row (`direction='inbound'`), updates `leads.phone` from `telephony_data.to_number`. |
| `enrichOutboundCall({ organisationId, callId, executionId })` | Outbound calls webhook when status = `completed` | Updates the existing `calls` row (`duration_seconds`, `ended_at`), writes transcript + turns. |

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

Two separate endpoints — both share `BOLNA_WEBHOOK_SECRET` and use the same header-compare auth.

| Route | File | Purpose |
| --- | --- | --- |
| `POST /api/webhooks/bolna/leads` | [src/app/api/webhooks/bolna/leads/route.ts](../src/app/api/webhooks/bolna/leads/route.ts) | Inbound call → lead (also triggers enrichment for phone + transcript) |
| `POST /api/webhooks/bolna/calls` | [src/app/api/webhooks/bolna/calls/route.ts](../src/app/api/webhooks/bolna/calls/route.ts) | Outbound call status updates (triggers transcript enrichment on `completed`) |

### Shared auth

The provider's dashboard webhook field is URL-only — no custom headers. The routes therefore accept the shared secret in **either** of two places, both compared in constant time:

1. `x-bolna-signature: <BOLNA_WEBHOOK_SECRET>` header — for curl tests or any caller that supports headers.
2. `?secret=<BOLNA_WEBHOOK_SECRET>` query string — for the provider dashboard, where you paste the full URL including the query parameter.

Pick a long random secret (`openssl rand -hex 32`), put it in `.env.local`, and append it to the URL you paste into the provider dashboard.

> **If the provider later adds HMAC signing**, replace the comparison with `crypto.createHmac("sha256", secret).update(rawBody).digest("hex")` and drop the query-string path. The query-string route is a pragmatic workaround, not a permanent design.

### Post-response enrichment

Both webhooks return `200` as soon as the core row is persisted. Expensive work (fetching `GET /executions/{id}`, parsing the transcript, upserting `call_transcripts`) runs via Next.js's `after()` so the webhook response is never held up by the retry budget. Failures inside `after()` are logged — they do not affect the `200`. See [`enrichInboundLead`](#enrichment-entry-points) / [`enrichOutboundCall`](#enrichment-entry-points).

### Inbound: `POST /api/webhooks/bolna/leads`

### Payload

At minimum the route expects:

```json
{
  "extracted_data": {
    "lead_data": {
      "business_slug":          { "subjective": "acme-motors", "reasoning_subjective": "Caller said they were calling Acme Motors.", ... },
      "name":                   { "subjective": "Neem", "reasoning_subjective": "Caller introduced themselves as Neem.", ... },
      "product":                { "subjective": "Honda Dio 2024", "reasoning_subjective": "Caller asked about the 2024 Dio.", ... },
      "customer_status":        { "objective":  "Buyer", "reasoning_subjective": "Caller said they want to purchase, not service.", ... },
      "lead_intent":            { "objective":  "Warm", "reasoning_subjective": "Caller is comparing models — interested but not ready to book.", ... },
      "connect_on_whatsapp":    { "subjective": "false", ... },
      "date_and_time_of_visit": { "subjective": "", ... }
    }
  },
  "call_id":           "<optional — used as idempotency key>",
  "from_phone_number": "<optional — stored on the lead>"
}
```

Extra top-level keys are allowed and ignored (the full body is stored in `raw_payload`). The top-level `call_id` / `execution_id` / `id` (whichever the provider sends) is stored on the lead as `external_id` — that is the key used to fetch the full execution (transcript + telephony_data) during enrichment.

### Extraction rules — [src/lib/bolna/extract.ts](../src/lib/bolna/extract.ts)

- For each field, `pickValue()` prefers `subjective`, falls back to `objective`. Empty strings are treated as absent.
- `connect_on_whatsapp` is coerced via `toBoolean()` (accepts `true|false|yes|no|1|0`).
- `date_and_time_of_visit` is coerced via `toTimestamp()` (ISO parseable → stored as UTC ISO; otherwise null).
- A per-field `confidence` map is captured and written to `leads.confidence`.
- **Summary (added 2026-04-28):** `buildSummary()` walks every key in `extracted_data.lead_data`, picks the per-field `reasoning_subjective` string, and concatenates them as `<Humanised Field>: <reasoning>` paragraphs separated by a blank line. The result is written to `leads.summary` and surfaced in the lead detail sheet under a "Summary" block. Fields without `reasoning_subjective` are skipped; if no field carries reasoning, `summary` stays `null`. On idempotent retry the upsert overwrites the column — manual edits to `summary` will be replaced if the same `call_id` is re-delivered before any human input.
- **Phone is *not* in `extracted_data`.** The provider delivers caller metadata separately on the execution record — it lands on the lead via `enrichInboundLead` (see below).

### Routing & idempotency

- `business_slug` → lookup on `organisations.slug` via the **admin client** (webhook is not an authenticated user session).
- If `call_id` / `execution_id` / `id` is present, the row is **upserted** on the unique index `(organisation_id, external_id)`. Retries produce at most one lead row.
- No id → plain insert. (Enrichment is also skipped in this case — no id means no way to call `GET /executions/{id}`.)
- After the lead upsert, the route schedules `enrichInboundLead` via `after()`. The enrichment job:
  1. Resolves the org's API key.
  2. Fetches `GET /executions/{external_id}` with retry.
  3. Writes `telephony_data.to_number` to `leads.phone`.
  4. Upserts a `calls` row (`direction='inbound'`).
  5. Parses the transcript blob and populates `call_transcripts` turns.
  6. Updates `calls.transcript_status` to `ready` / `skipped` / `failed`.
  Failures are logged; the webhook response is already `200`.

### Responses

| Status | When |
| --- | --- |
| `200` | Lead inserted/upserted — body `{ "id": "<lead id>" }` |
| `400` | Invalid JSON / schema / missing `business_slug` |
| `401` | Missing or wrong signature |
| `404` | No organisation matches the slug (Bolna will **not** retry) |
| `500` | Supabase lookup/insert failed (Bolna will retry) |

### Test the inbound webhook with curl

```bash
curl -X POST http://localhost:3000/api/webhooks/bolna/leads \
  -H "Content-Type: application/json" \
  -H "x-bolna-signature: $BOLNA_WEBHOOK_SECRET" \
  -d '{
    "call_id": "test-123",
    "from_phone_number": "+91-99999-00000",
    "extracted_data": {
      "lead_data": {
        "business_slug": { "subjective": "acme-motors", "confidence": 1 },
        "name":          { "subjective": "Neem",        "confidence": 0.6 },
        "product":       { "subjective": "Honda Dio",   "confidence": 0.8 },
        "lead_intent":   { "objective":  "Warm",        "confidence": 0.7 },
        "connect_on_whatsapp": { "subjective": "true",  "confidence": 0.9 }
      }
    }
  }'
```

Expected: `200 { "id": "<lead uuid>" }`. The new lead appears at `/leads`.

### Point Bolna at your local server (ngrok)

Bolna can only call public URLs. To test against `localhost:3000`:

```bash
# in one terminal
npm run dev
# in another
ngrok http 3000
# copy the https://xxxx.ngrok-free.app URL
```

In the Bolna dashboard → **Agent → Analytics → Post Call Tasks**, paste the full URL with the secret as a query parameter (no header configuration is available in Bolna's UI):

- Inbound lead: `https://xxxx.ngrok-free.app/api/webhooks/bolna/leads?secret=<BOLNA_WEBHOOK_SECRET>`
- Call status: `https://xxxx.ngrok-free.app/api/webhooks/bolna/calls?secret=<BOLNA_WEBHOOK_SECRET>`

Trigger a test call from the Bolna dashboard; watch the Next.js terminal for the request and the `calls` / `leads` table for the new row.

> **Why a query string?** Bolna's current UI doesn't let you add custom headers, so the server accepts the secret either via `x-bolna-signature` header (for curl) or `?secret=…` query string (for Bolna). Rotate the secret if it ever leaks — logs and referrers can capture URLs.

### Outbound: `POST /api/webhooks/bolna/calls`

Fired by the provider when a call's status changes (ringing → in_progress → completed, or failed). When the mapped status is `completed`, the route schedules `enrichOutboundCall` via `after()` to fetch and store the transcript.

**Expected payload (subset — extra keys allowed):**

```json
{
  "call_id":          "bolna-uuid",
  "status":           "completed",
  "started_at":       "2026-04-22T10:00:00Z",
  "answered_at":      "2026-04-22T10:00:04Z",
  "ended_at":         "2026-04-22T10:02:30Z",
  "duration_seconds": 146,
  "recording_url":    "https://.../rec.mp3",
  "transcript_url":   "https://.../transcript.txt",
  "summary":          "Lead confirmed visit on Saturday.",
  "error_code":       null,
  "error_message":    null
}
```

**Status mapping** (case-insensitive): `initiated|queued` → `initiated`, `ringing` → `ringing`, `answered|in_progress|in-progress` → `in_progress`, `completed|ended` → `completed`, `no_answer|no-answer`, `busy`, `canceled|cancelled`, `failed`.

**Responses:**

| Status | When |
| --- | --- |
| `200` | Call updated — body `{ "id": "<call uuid>", "status": "<mapped>" }` |
| `400` | Invalid JSON / schema / missing `call_id` / unknown status |
| `401` | Missing or wrong signature |
| `404` | No call with that `bolna_call_id` (already deleted, or call was initiated elsewhere) |
| `500` | Supabase update failed (Bolna will retry) |

### Test the outbound webhook end-to-end

1. **Configure** Bolna in Settings (see previous section).
2. **Create or pick a lead** with a phone number at `/leads`.
3. **Click the phone icon** on the lead row. The toast should say "Calling <name>…". A row appears in `public.calls` with `status = 'initiated'` and a `bolna_call_id`.
4. **Watch the call complete** in Bolna's dashboard, or simulate the webhook manually:

   ```bash
   curl -X POST http://localhost:3000/api/webhooks/bolna/calls \
     -H "Content-Type: application/json" \
     -H "x-bolna-signature: $BOLNA_WEBHOOK_SECRET" \
     -d '{
       "call_id":          "<paste bolna_call_id from the DB>",
       "status":           "completed",
       "answered_at":      "2026-04-22T10:00:04Z",
       "ended_at":         "2026-04-22T10:02:30Z",
       "duration_seconds": 146,
       "summary":          "Test: lead confirmed demo Saturday."
     }'
   ```

   Expected: `200 { "id": "<call uuid>", "status": "completed" }`, and the matching `calls` row now has `status = 'completed'` with the duration and summary populated.

5. **Negative test — wrong signature:**
   ```bash
   curl -X POST http://localhost:3000/api/webhooks/bolna/calls \
     -H "Content-Type: application/json" \
     -H "x-bolna-signature: nope" \
     -d '{"call_id":"x","status":"completed"}'
   # → 401 Unauthorized
   ```

6. **Negative test — unknown call id:** use a `call_id` that doesn't exist → `404`. Bolna will retry; fix the mismatch (usually a typo or a call started against a different environment).

### Local-only manual test without Bolna

You don't need Bolna set up to smoke the DB path end-to-end:

```bash
# 1. Insert a fake integration row (run in Supabase SQL editor; ORG_ID is real):
insert into public.bolna_integrations (organisation_id, agent_id, api_key)
values ('<ORG_ID>', 'fake-agent', 'sk-fake')
on conflict (organisation_id) do update set agent_id = excluded.agent_id;

# 2. Point the client at a local mock:
export BOLNA_API_BASE_URL=http://localhost:4000
# and run any tiny server on :4000 that replies { "call_id": "mock-1", "status": "initiated" }.

# 3. Click "Call" on a lead in the UI. A calls row should be created.
# 4. Then POST to /api/webhooks/bolna/calls with call_id=mock-1, status=completed.
```

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

The admin panel is for **Skello staff** (not org owners). All admin Server Actions run through the **service-role client** (`createAdminClient()`), bypassing RLS, and are gated at the top by `requireAdmin()`. Every gate is checked on both the route layout and the action itself — defense in depth. Owners lose the ability to configure the voice agent; that moved here entirely. Settings now renders a read-only `VoiceAgentStatusCard`.

### `requireAdmin()`

Returns `{ userId, email }` on success. Redirects:

- no auth user → `/login`
- user is not an admin → `/dashboard` (no enumeration signal)
- user is an admin → returns, **regardless of whether they own an organisation**. Admins are typically org-less Skello staff.

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
| `getVoiceAgentAdmin` | `organisationId` (uuid) | returns `BolnaIntegration` (with `api_key_last4`) or null |
| `upsertVoiceAgentAdmin` | `{ organisation_id, agent_id, api_key, from_phone_number?, enabled }` | creates or replaces the integration |
| `updateVoiceAgentAdmin` | partial upsert shape | patches agent id / key / caller id / enabled |
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
5. **Webhook signature** — Constant-time compare of a shared secret. Never trust tenant ids from payload — always resolve server-side from `business_slug`.
6. **Input validation** — Zod at every boundary. No `any`, no `@ts-ignore`.

**Things a future reviewer should check:**

- No Server Action should ever pull `organisation_id` straight from client input without a `userOwnsOrg` gate.
- No `SELECT *` on hot paths — use an explicit column list (see `LEAD_LIST_COLUMNS`).
- Any new table must get RLS enabled **and** explicit policies. A table with RLS on and zero policies = empty to everyone.
