# Skello Backend API Reference

All mutations and queries live in Server Actions under [src/actions/](../src/actions/). External integrations (Bolna) come in through Route Handlers under [src/app/api/](../src/app/api/).

> Looking for the UI surface (pages, layouts, navigation flow)? See [sitemap.md](sitemap.md).

---

## Table of Contents

1. [Conventions](#conventions)
2. [Setup & Environment](#setup--environment)
3. [Authentication](#authentication)
4. [Organisations](#organisations)
5. [Leads](#leads)
6. [Reminders](#reminders)
7. [Bolna Integration (per-org)](#bolna-integration-per-org)
8. [Outbound Calls](#outbound-calls)
9. [Bolna Webhooks](#bolna-webhooks)
10. [Security Model](#security-model)

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

> Bolna **API keys** are **per-organisation** — stored in the `bolna_integrations` table and configured by each org admin in Settings. Skello itself does not hold a global Bolna key.

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
- `20260422000000_bolna_integrations_and_calls.sql` — per-org Bolna config (service-role only) and outbound `calls` table. Required for the Bolna outbound dialler.
- `20260422000001_leads_external_id_full_unique.sql` — replaces the partial unique index on `(org_slug, external_id)` with a full one so the inbound-lead webhook's `onConflict` upsert works.

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
name, product,
lead_intent (enum: hot | warm | cold),    -- Postgres enum `intent_type`
visit_date_time, customer_status,
phone,                        -- nullable; consumed by the WhatsApp dialog
wants_to_connect_on_watsapp,  -- from Bolna: what the customer wants
contacted_on_watsapp          -- set by the team: what we have done
```

Tenant scoping on `leads` is via **`org_slug` (text)**, enforced by FK `leads.org_slug → organisations.slug` (cascade on update/delete). All actions also gate on the caller owning that org.

**Idempotency**: `external_id` + unique index `(org_slug, external_id) where external_id is not null` allows Bolna webhook retries to be safely upserted without creating duplicates.

> Column names are `watsapp` (not `whatsapp`). Code mirrors the DB exactly — renaming later would need a migration plus coordinated code change.

### `listLeads(input)`

**Input**
```ts
{
  org_slug: string;                           // required
  limit?: number;                             // 1–200, default 50
  offset?: number;                            // default 0
  lead_intent?: "hot" | "warm" | "cold";
  customer_status?: string;                   // e.g. "Buyer"
  contacted_on_watsapp?: boolean;
}
```
**Returns** `ActionResult<{ items: Lead[]; total: number }>` — full `Lead` shape ordered by `created_at desc`.

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
  product?: string | null;
  customer_status?: string | null;
  lead_intent?: "hot" | "warm" | "cold" | null;
  phone?: string | null;                               // ≤ 32 chars; UI normalises before wa.me
  wants_to_connect_on_watsapp?: boolean | null;
  visit_date_time?: string | null;                    // ISO 8601 with offset
}
```

### `updateLead(id, input)`

Same shape as create minus `org_slug`, plus `contacted_on_watsapp?: boolean`. Empty patches rejected.

### `deleteLead(id)`

Hard-deletes. Linked reminders have `lead_id` set to null.

### `toggleLeadContactedOnWhatsApp(id)`

Fetches the current `contacted_on_watsapp` and flips it. Returns the updated `Lead`.

```ts
// In a row action button
async function onToggle(leadId: string) {
  const res = await toggleLeadContactedOnWhatsApp(leadId);
  if (!res.success) toast.error(res.error);
}
```

The UI's WhatsApp dialog ([src/components/app/whatsapp-dialog.tsx](../src/components/app/whatsapp-dialog.tsx)) calls this automatically after the user clicks **Open WhatsApp** — `wa.me/<digits>?text=<encoded message>` opens in a new tab and the lead is marked as contacted in the same transition.

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

## Bolna Integration (per-org)

Files:
- Actions: [src/actions/bolna-integrations.ts](../src/actions/bolna-integrations.ts)
- Type: [src/types/bolna-integration.ts](../src/types/bolna-integration.ts)
- Table: `public.bolna_integrations` — primary key is `organisation_id`. RLS enabled with **no** policies for authenticated users; all access is via the service-role admin client, gated by `userOwnsOrg()`.
- UI: Settings → Bolna integration card ([src/components/app/bolna-integration-form.tsx](../src/components/app/bolna-integration-form.tsx)).

### Why this design

Each tenant has its own Bolna account, agent, and API key. Storing one row per org keeps tenants fully isolated, and making the table invisible to the user-session Supabase client keeps the `api_key` column off the wire — the key never appears in a browser request, even accidentally.

The public `BolnaIntegration` type exposes `api_key_last4` for display; the full key is only visible server-side when invoking the Bolna API.

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

Removes the integration. Outbound calls will fail with `"Bolna integration not configured"` until it's re-added.

### Testing the integration from Settings

1. Log into Skello as an org owner.
2. Navigate to **Settings → Bolna integration**.
3. Paste the agent ID and API key from your Bolna dashboard → **Connect Bolna**.
4. The card should flip to **Connected**. The api_key field clears; the placeholder shows `sk-••••<last 4>` as confirmation.
5. To verify the key is not exposed: open browser DevTools → Network → refresh — the Settings response does not contain the full api_key (only `api_key_last4`).

---

## Outbound Calls

Files:
- Action: [src/actions/calls.ts](../src/actions/calls.ts)
- Client: [src/lib/bolna/client.ts](../src/lib/bolna/client.ts)
- Type: [src/types/call.ts](../src/types/call.ts)
- Table: `public.calls` — tenant-scoped, RLS tied to org ownership.

### `initiateCall(input)`

**Input** `{ lead_id: string }` (uuid).

**Flow:**
1. Resolve the lead → get `org_slug` + `phone`.
2. Verify the authenticated user owns that org.
3. Fetch the org's `bolna_integrations` row via the admin client.
4. Call `POST ${BOLNA_API_BASE_URL}/call` with `{ agent_id, recipient_phone_number, from_phone_number?, user_data: { lead_id, organisation_id, lead_name } }` and `Authorization: Bearer <api_key>`.
5. Insert a `calls` row with `status = 'initiated'` and `bolna_call_id` from Bolna's response.
6. If Bolna errors, a `calls` row with `status = 'failed'` and `error_message` is still inserted for audit.

**Returns** `ActionResult<Call>`.

**Failure reasons:**
- `"Lead has no phone number"` — lead's `phone` is null.
- `"Bolna integration not configured. Set it up in Settings."` — no row in `bolna_integrations`.
- `"Bolna integration is disabled for this organisation."` — `enabled = false`.
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
Returns `ActionResult<{ items: Call[]; total: number }>`, ordered by `started_at desc`.

### UI trigger

The leads table ([src/components/app/leads-table.tsx](../src/components/app/leads-table.tsx)) renders a **phone icon button** per row. Clicking it calls `initiateCall({ lead_id })`; the button is disabled when the lead has no phone. The dropdown menu has an equivalent "Call via Bolna" entry.

---

## Bolna Webhooks

Two separate endpoints — both share `BOLNA_WEBHOOK_SECRET` and use the same header-compare auth.

| Route | File | Purpose |
| --- | --- | --- |
| `POST /api/webhooks/bolna/leads` | [src/app/api/webhooks/bolna/leads/route.ts](../src/app/api/webhooks/bolna/leads/route.ts) | Inbound call → lead |
| `POST /api/webhooks/bolna/calls` | [src/app/api/webhooks/bolna/calls/route.ts](../src/app/api/webhooks/bolna/calls/route.ts) | Outbound call status updates |

### Shared auth

Bolna's dashboard webhook field is URL-only — no custom headers. The routes therefore accept the shared secret in **either** of two places, both compared in constant time:

1. `x-bolna-signature: <BOLNA_WEBHOOK_SECRET>` header — for curl tests or any caller that supports headers.
2. `?secret=<BOLNA_WEBHOOK_SECRET>` query string — for Bolna's dashboard, where you paste the full URL including the query parameter.

Pick a long random secret (`openssl rand -hex 32`), put it in `.env.local`, and append it to the URL you paste into Bolna.

> **If Bolna later adds HMAC signing** (check [their analytics-tab docs](https://www.bolna.ai/docs/agent-setup/analytics-tab)), replace the comparison with `crypto.createHmac("sha256", secret).update(rawBody).digest("hex")` and drop the query-string path. The query-string route is a pragmatic workaround, not a permanent design.

### Inbound: `POST /api/webhooks/bolna/leads`

### Payload

At minimum the route expects:

```json
{
  "extracted_data": {
    "lead_data": {
      "business_slug":          { "subjective": "acme-motors", ... },
      "name":                   { "subjective": "Neem", ... },
      "product":                { "subjective": "Honda Dio 2024", ... },
      "customer_status":        { "objective":  "Buyer", ... },
      "lead_intent":            { "objective":  "Warm", ... },
      "connect_on_whatsapp":    { "subjective": "false", ... },
      "date_and_time_of_visit": { "subjective": "", ... }
    }
  },
  "call_id":           "<optional — used as idempotency key>",
  "from_phone_number": "<optional — stored on the lead>"
}
```

Extra top-level keys are allowed and ignored (the full body is stored in `raw_payload`).

### Extraction rules — [src/lib/bolna/extract.ts](../src/lib/bolna/extract.ts)

- For each field, `pickValue()` prefers `subjective`, falls back to `objective`. Empty strings are treated as absent.
- `connect_on_whatsapp` is coerced via `toBoolean()` (accepts `true|false|yes|no|1|0`).
- `date_and_time_of_visit` is coerced via `toTimestamp()` (ISO parseable → stored as UTC ISO; otherwise null).
- A per-field `confidence` map is captured and written to `leads.confidence`.

### Routing & idempotency

- `business_slug` → lookup on `organisations.slug` via the **admin client** (webhook is not an authenticated user session).
- If `call_id` / `execution_id` / `id` is present, the row is **upserted** on the unique index `(organisation_id, external_id)`. Retries from Bolna produce at most one lead row.
- No id → plain insert.

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

Fired by Bolna when a call's status changes (ringing → in_progress → completed, or failed).

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
