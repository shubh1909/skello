# Integrations — Lead Intake Implementation Plan

**Status:** All four phases **built** (Phases 0/1/3 on 2026-08-12, Phase 2 on 2026-08-17)
— ⚠️ migrations still not applied, so nothing is live yet.
**Date:** 2026-08-12, last updated 2026-08-17
**Goal:** a new top-level **Integrations** surface that captures leads from Google Ads
lead forms, Click-to-WhatsApp ads, and 99acres — alongside the voice agent, which is
unchanged.

---

## 1. Decisions (locked)

| Decision | Choice | Consequence |
|---|---|---|
| WhatsApp path | **Meta Cloud API direct**, not KwikEngage | We own the webhook, so we see the `referral` object. KwikEngage never documented its inbound schema and may not forward CTWA attribution at all. |
| WABA ownership | **Client brings their own** Meta app + WABA | Live in days, no Meta app review. Per-org credentials; onboarding is a manual checklist. Tech-Provider Embedded Signup is the later migration, not v1. |
| KwikEngage | **Stays, per-org** | `whatsapp_integrations.provider` already exists for exactly this. Shopify orgs keep KwikEngage for cart-recovery/COD templates; real-estate orgs run Cloud API. No schema change, no touching live revenue paths. |
| Inbound lead rule | **Ad-referred + first-time senders** | A message with a `referral` object always makes a lead. A plain inbound makes one only if no lead exists for that phone. Known customers messaging "hi" change nothing. |
| Auto-action on new lead | **None** | Lead lands with `status = 'new'` under its source. No auto-dial, no auto-reply. Speed-to-lead automation is a later ticket, and it needs quiet hours first. |
| Who provisions endpoints | **Skelo team, in the admin console** | Credentials never sit behind a form an org owner can reach. `/integrations` is read-only: the two values to paste elsewhere, plus the delivery log and re-run. Matches how voice agents and Shopify already work. |
| Repeat ad taps | **Newest ad wins** | `custom_data.whatsapp` describes the most recent ad. History stays in the delivery log rather than becoming a JSONB array the lead-sheet bindings can't render. |
| WhatsApp log volume | **Only messages that create or update a lead** | A known customer's reply is acked and dropped with no row. Keeps the log a log, not an inbox. |
| Closed lead re-engages | **Reopen `won`/`lost` to `new`** | Someone responding to a new campaign is a live opportunity again; leaving them filed under "lost" hides them from every pipeline view. In-flight statuses are untouched. |
| Voice agent ingest | **Unchanged** | The Bolna inbound/outbound call path stays exactly as it is. This plan *reuses* its lead-merge core; it does not modify its behaviour. |

### Assumption made without asking

Field mapping ships as a per-source `field_map jsonb` with sensible defaults baked in
code. It is editable from the admin console in Phase 2 (when 99acres forces the issue),
not Phase 1. Rationale: Google's `column_id` values are a fixed enum — a hardcoded map
is correct there; 99acres field names vary per seller account, so that channel cannot
work without the map being data.

---

## 2. Scope

**In scope**

- One shared lead-intake spine (config + event ledger + normaliser + ingest).
- Three channel adapters: Google Ads lead forms, WhatsApp CTWA, 99acres.
- A customer-facing `/integrations` route with per-channel setup and a delivery log.

**Out of scope**

- Any change to voice-agent lead ingest, cart recovery, or COD confirmation.
- Outbound WhatsApp on Cloud API (inbound only; KwikEngage keeps outbound for the orgs
  that have it). The adapter is structured so outbound is an additive change.
- Meta Embedded Signup / Tech Provider verification.
- Auto-dial, auto-reply, lead assignment, round-robin.
- Magicbricks / Housing — but the portal adapter is built so each is a config row plus
  one `ALTER TYPE … ADD VALUE`, not a new route.

---

## 3. Architecture

Three integrations, **one pipeline**. Every channel does the same five things, and only
step 2 differs:

```
  1. Receive   → resolve tenant from the URL token or the receiving number, never the payload
  2. Verify    → per-channel: google_key / X-Hub-Signature-256 / IP + token
  3. Record    → write lead_intake_events BEFORE acking (durability, dedupe, replay)
  4. Normalise → channel adapter → { phone, name, email, lead_data, custom_data }
  5. Ingest    → shared find-or-create + override-aware merge + field auto-discovery
```

### What we reuse rather than rebuild

`src/lib/bolna/lead-merge.ts` already contains the whole of step 5 and it is correct:

- `findOrCreateLead()` (`:207`) — dedupe on `(organisation_id, phone_normalized)` with
  `deleted_at IS NULL`, so a soft-deleted lead can't be merged into.
- `mergeOntoLead()` (`:375`) — honours `lead_field_overrides` locks, writes JSONB via
  the `apply_lead_field_jsonb` RPC.
- `registerDiscoveredFields()` (`:286`) — upserts every discovered key into
  `lead_field_definitions` via `register_lead_field`.

**Refactor, don't fork:** lift these three out of `lib/bolna/` into
`src/lib/leads/ingest.ts`, keyed off a channel-neutral snapshot
(`{ lead_data, custom_data }`) rather than a `BolnaLeadPayload`. `lead-merge.ts` keeps
its Bolna-specific `buildSnapshot()` and calls the shared core. Behaviour of the voice
path must not change — its tests are the regression gate.

**Why this matters more than it looks:** field auto-discovery means a 99acres *budget*
or a CTWA *ad headline* arrives as a registered `lead_field_definition`, which makes it
immediately bindable to a stat card or a "What they want" row on the lead sheet built
last week. No per-channel UI work to show per-channel data.

### Tenancy

`createAdminClient()` bypasses RLS **and** soft-delete filtering. Every intake path is a
service-role path, so: scope by `organisation_id` by hand, filter `deleted_at IS NULL`
by hand, and write **both** `organisation_id` and `org_slug` on any `leads` insert.

Tenant resolution per channel, never from the payload:

| Channel | Resolved from |
|---|---|
| Google Ads | opaque `token` in the URL path |
| 99acres / portals | opaque `token` in the URL path |
| WhatsApp | opaque `token` in the URL path → then verified with *that org's* app secret |

The WhatsApp case is the Shopify pattern exactly ([shopify/route.ts:52-67](../src/app/api/webhooks/shopify/route.ts#L52-L67)): each client's Meta app has its own
`app_secret`, so we cannot verify a signature until we know whose it is. Resolve first,
verify second, and treat an unresolvable token as an unauthenticated request.

---

## 4. Data model

Two new tables plus enum values. Migrations numbered from `20260813000000`.

### `lead_intake_sources`

One row per (org, channel). Holds secrets → **RLS enabled with no authenticated
policies**, service-role only, ownership checked in the Server Action. This mirrors
`whatsapp_integrations` / `bolna_integrations`; the customer-facing read goes through an
action that returns a redacted view.

```sql
create table public.lead_intake_sources (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  channel          text not null
                     check (channel in ('google_ads','whatsapp','portal_99acres')),
  -- Human label; a builder may run two Google accounts for two projects.
  name             text,
  -- The unguessable URL segment. 32 random bytes, base64url. This is the ONLY
  -- thing standing between the internet and a tenant on channels with no
  -- signature (99acres), so it is generated server-side and never user-chosen.
  public_token     text not null unique,
  -- Channel-specific credentials. google_key / portal api_key / Meta app_secret,
  -- access_token, phone_number_id, waba_id, verify_token.
  credentials      jsonb not null default '{}'::jsonb,
  -- Payload key → our field. Defaults live in code; this overrides per account.
  field_map        jsonb not null default '{}'::jsonb,
  enabled          boolean not null default true,
  last_event_at    timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organisation_id, channel, public_token)
);

create index on public.lead_intake_sources (organisation_id, channel);
alter table public.lead_intake_sources enable row level security;
-- No authenticated policies — service-role only.
```

### `lead_intake_events`

One row per delivery. This is the delivery log the Integrations tab renders, the
idempotency key, and the replay buffer for a portal whose schema we're still learning.

```sql
create table public.lead_intake_events (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  source_id        uuid not null references public.lead_intake_sources (id) on delete cascade,
  channel          text not null,
  -- Google lead_id / WhatsApp wamid / portal enquiry id. Null only when the
  -- channel gives us nothing to key on — then dedupe degrades to "accept once".
  external_id      text,
  status           text not null default 'received'
                     check (status in ('received','processed','duplicate','test','ignored','failed')),
  lead_id          uuid references public.leads (id) on delete set null,
  payload          jsonb not null,
  error            text,
  received_at      timestamptz not null default now(),
  processed_at     timestamptz
);

-- The idempotency gate. Partial so a null external_id never blocks a delivery.
create unique index lead_intake_events_dedupe
  on public.lead_intake_events (source_id, external_id)
  where external_id is not null;

create index on public.lead_intake_events (organisation_id, received_at desc);
alter table public.lead_intake_events enable row level security;
```

`lead_intake_events` **does** get an authenticated SELECT policy (org owners read their
own delivery log — that is the entire point of the tab). Payloads may contain a phone
number and a name; nothing more sensitive, and the customer already owns that data.

### Enum

```sql
alter type public.lead_source add value if not exists 'google_ads';
alter type public.lead_source add value if not exists 'portal_99acres';
```

⚠️ **Own migration file, used nowhere in it.** `ADD VALUE` cannot be *used* in the
transaction that adds it — the same discipline as
`20260628000000_lead_source_shopify.sql`. `whatsapp` is already in the enum.

Granular per-portal values rather than a single `portal`: the leads page filters and the
pipeline tabs read this enum, and a builder wants "99acres" and "Magicbricks" as separate
lines, not one bucket.

### Retention

`lead_intake_events` grows forever otherwise. Add a cron sweep deleting rows older than
90 days with `status <> 'failed'`; keep failures indefinitely until someone looks at them.

---

## 5. Channel specifications

### 5.1 Google Ads lead forms

**Mechanism.** Google POSTs JSON to an HTTPS URL the advertiser pastes into the Google
Ads UI, per lead form asset. There is no API to register it — the product surface is
"copy this URL and this key."

**Payload.**

```jsonc
{
  "lead_id": "…",              // dedupe key — NOT exactly-once
  "user_column_data": [        // the actual lead
    { "column_id": "FULL_NAME",    "string_value": "…", "column_name": "Full name" },
    { "column_id": "PHONE_NUMBER", "string_value": "…" }
  ],
  "api_version": "1.0",
  "form_id": 1234,             // int64
  "campaign_id": 1234,
  "adgroup_id": 1234,          // video/discovery only
  "creative_id": 1234,
  "asset_group_id": 1234,      // Performance Max
  "gcl_id": "…",
  "google_key": "…",           // the shared secret, echoed back
  "is_test": false,
  "lead_stage": "…",
  "lead_submit_time": "2026-08-12T12:30:00Z",
  "lead_source": "LEAD_FORM"   // or CONVERSATIONAL_AGENT
}
```

**Verification.** `google_key` is the *only* authentication — a plaintext secret in the
body, no signature. Compare in constant time (`timingSafeEqual`, as
[kwikengage/route.ts:15](../src/app/api/webhooks/kwikengage/route.ts#L15) already does).
The URL token carries tenancy so a leaked key alone picks nothing.

**Response contract — inverted from Shopify's, and this is the trap.**

| Situation | Status | Body |
|---|---|---|
| Accepted (incl. duplicate, incl. test) | `200` | `{}` |
| Bad payload, bad key, unknown token | `4XX` | `{"message": "…"}` — never retried |
| DB write failed / transient | `5XX` | `{"message": "…"}` — **retried** |

Our Shopify route deliberately 200-acks unknown shops to stop retries. Here, swallowing a
transient failure with a 200 loses the lead permanently. A failed
`lead_intake_events` insert **must** return 503.

**Test leads.** Google fires one with `is_test: true` when the advertiser saves the form.
Record it as `status = 'test'`, create no lead, and surface it prominently in the UI —
it is the onboarding "it works" signal.

**Field map (default).**

| `column_id` | Target |
|---|---|
| `FULL_NAME` / `FIRST_NAME` + `LAST_NAME` | `leads.name` |
| `PHONE_NUMBER` | `leads.phone` |
| `EMAIL` | `lead_data.email` |
| `CITY` / `POSTAL_CODE` | `leads.city` / `leads.pincode` |
| anything else (incl. custom questions) | `custom_data[''] [column_id]` → auto-registered |

Custom qualifying questions ("budget?", "possession timeline?") arrive with the
advertiser's own `column_id`, so the catch-all is what makes this useful for real estate.

**Also store** `campaign_id`, `form_id`, `gcl_id` under `custom_data.google_ads` — that
is the attribution trail back to spend.

---

### 5.2 WhatsApp — Click-to-WhatsApp ads (Meta Cloud API, direct)

**Mechanism.** Client's Meta app subscribes its WABA to the `messages` webhook field and
points it at our per-org URL. A user taps a CTWA ad → WhatsApp chat opens → their first
message reaches us carrying the ad context.

**Per-org credentials** (in `lead_intake_sources.credentials`), all supplied by the client:

| Key | Used for |
|---|---|
| `phone_number_id` | identifying the receiving number; later, sending |
| `waba_id` | reference / support |
| `access_token` | System User permanent token — outbound only, unused in v1 |
| `app_secret` | verifying `X-Hub-Signature-256` |
| `verify_token` | **we generate it**, client pastes it into Meta |

**Two request types on one route.**

`GET` — Meta's subscription handshake. Echo `hub.challenge` as `text/plain` **only** if
`hub.mode === 'subscribe'` and `hub.verify_token` matches this source's `verify_token`;
otherwise 403.

`POST` — the event. Verify `X-Hub-Signature-256` = HMAC-SHA256 of the **raw body** with
this org's `app_secret`. Read the body once as text, hash it, then parse — a re-serialised
body will not match.

**Payload path.**

```
entry[].changes[].value
  ├─ metadata { display_phone_number, phone_number_id }
  ├─ contacts[] { profile: { name }, wa_id }
  ├─ messages[] { from, id (wamid), timestamp, type, text: { body },
  │               referral? { source_url, source_id, source_type,
  │                          headline, body, media_type, image_url, ctwa_clid } }
  └─ statuses[]   ← delivery receipts; ignored in v1
```

**The three facts that decide whether this works at all:**

1. **`referral` only appears on the *first* message** of a conversation started from an
   ad. Miss it and the attribution is gone — so the event ledger stores the raw payload
   before anything else can fail.
2. **"Ads Attribution" must be enabled** on the WABA in WhatsApp Manager, or Meta omits
   `referral` entirely. This is a client-side toggle and a silent failure: leads arrive,
   attribution doesn't. Put it in the onboarding checklist **and** surface "N inbound, 0
   with ad attribution" in the UI so it's diagnosable.
3. `ctwa_clid` is what Meta's Conversions API needs to attribute conversions back to ad
   spend. We only *store* it in v1 — sending conversions back is a later ticket, but the
   value must be captured now because it is unrecoverable later.

**Lead rule (as decided).**

```
if (message.referral)            → find-or-create lead, always
else if (no live lead for phone) → create lead
else                             → record event as 'ignored', touch nothing
```

Note the middle branch must filter `deleted_at IS NULL` — a soft-deleted lead is not a
live lead, and the partial unique index is built for exactly that.

**Stored on the lead:** `custom_data.whatsapp` = `{ ad_id: source_id, ad_headline,
ad_body, source_url, ctwa_clid, first_message }`. `leads.source = 'whatsapp'`,
`leads.name` from `contacts[0].profile.name` (the WhatsApp display name — often the
only name we get).

**Dedupe** on `wamid`. Meta redelivers.

**Response:** `200` fast, work deferred with `after()`. Meta retries non-2xx with
backoff for up to ~7 days; unlike Google, a 200 after a durable write is the right shape.

---

### 5.3 99acres (and portals generally)

**Mechanism.** There is no public developer documentation. Every CRM that integrates
99acres does the same thing: 99acres POSTs each enquiry to a webhook URL registered
against the seller account. Some accounts expose it in the seller dashboard under a Lead
API / webhook setting; most require the 99acres RM to register and whitelist the URL.

**Consequences for us:**

- **We cannot write the parser before seeing one real payload.** Field names vary per
  seller account. This is why `field_map` is data, and why the event ledger stores raw
  bodies — the first live enquiry is the spec.
- **Auth is usually nothing** beyond URL secrecy; some accounts add an `api_key` query
  param. So: a 32-byte token in the path, optional `api_key` check when the account has
  one, and IP allowlisting via the existing `clientIpAllowed` helper if 99acres will
  give us ranges.
- **Build it as a `portal` adapter**, not a 99acres route. Magicbricks and Housing deliver
  the same way; each new one is a `field_map` row, an enum value and a logo.

**Expected fields** (to be confirmed against a live payload): name, mobile, email,
project / property name, property code, city / locality, budget or price, enquiry
message, enquiry timestamp.

**Default mapping:** phone → `leads.phone`, name → `leads.name`, city → `leads.city`,
message → `leads.notes`; everything else → `custom_data.portal` and auto-registered, so
"project" and "budget" become bindable lead-sheet rows without code.

**Unmapped-payload behaviour:** if the adapter can't find a phone, record the event as
`failed` with the raw body and show it in the UI. Never silently drop — that is the whole
lesson of the KwikEngage parser, which acked unrecognised payloads into a log nobody read.

---

## 6. Routes

All under the existing `/api/webhooks/` convention. `runtime = 'nodejs'` (raw body +
`node:crypto`), `dynamic = 'force-dynamic'`.

| Route | Method | Verify | Ack |
|---|---|---|---|
| `/api/webhooks/google-ads/[token]` | POST | `google_key`, constant-time | 200 `{}` / 4xx / **5xx on transient** |
| `/api/webhooks/whatsapp/[token]` | GET | `hub.verify_token` | echo `hub.challenge` |
| `/api/webhooks/whatsapp/[token]` | POST | `X-Hub-Signature-256` w/ org's `app_secret` | 200, work in `after()` |
| `/api/webhooks/portal/[token]` | POST | token + optional `api_key` + optional IP allowlist | 200, work in `after()` |

Each route is rate-limited with `checkRateLimit` keyed by token (not IP — Google and Meta
come from wide ranges).

---

## 7. Server Actions

`src/actions/lead-intake.ts` — all returning `ActionResult<T>` via `ok()` / `fail()`:

- `listIntakeSources()` — session org; **redacted** (never returns `access_token` or
  `app_secret`; returns `google_key` and `verify_token`, which the customer must paste).
- `createIntakeSource({ channel, name })` — generates `public_token` and, for WhatsApp, a
  `verify_token`. Returns the webhook URL to display.
- `updateIntakeSource({ id, credentials?, field_map?, enabled? })`
- `rotateIntakeToken({ id })` — the answer to a leaked URL.
- `deleteIntakeSource({ id })`
- `listIntakeEvents({ source_id?, status?, limit, offset })` — the delivery log.
- `replayIntakeEvent({ id })` — re-run ingest from the stored raw payload. This is what
  makes a mis-mapped 99acres account recoverable instead of a lost week of leads.

Ownership is checked with the existing `userCanManageOrg` helper in
`src/lib/auth/org-access.ts` before any service-role write.

---

## 8. UI

**New route `/integrations`**, added to the **System** section of
[src/lib/nav.ts:102](../src/lib/nav.ts#L102) above Settings, icon `PlugZapIcon`.

**Move the existing integration cards off Settings.** `VoiceAgentStatusCard`,
`WhatsAppStatusCard` and `ShopifyStatusCard` currently sit in
[settings/page.tsx](<../src/app/(app)/settings/page.tsx>), which is otherwise a workspace
form and an account form. After the move, Settings is workspace + account + data import;
Integrations is every connection in one place.

**Layout:** URL-backed `NavTabs` (`?channel=`), one tab per channel, same pattern as the
admin lead-fields page. Tab counts show events received in the last 7 days.

Each channel tab:

1. **Status** — connected / not configured / error, and *last event received*. A
   timestamp is the only honest health signal for a push integration.
2. **Setup** — copyable webhook URL, copyable key/verify-token, and the step-by-step for
   that channel (where in Google Ads to paste it; which Meta toggle to enable).
3. **Delivery log** — recent `lead_intake_events`: time, status badge, name/phone, link
   to the lead, and a raw-payload viewer. Test leads flagged. `failed` rows get a
   **Replay** button.
4. **Field mapping** — Phase 2; a table of "payload key → Skelo field" using the same
   picker built for lead-sheet bindings.

**Leads page:** source appears as a coloured chip on the row. No structural change — the
pipeline tabs and stat cards stay as they are.

---

## 9. Phases

Ordered so each phase leaves something shippable, and so the two externally-blocked
channels come after the spine is proven.

### Phase 0 — the spine (no channel) — ✅ built

`20260813000000_lead_source_intake_channels.sql`,
`20260813000001_lead_intake.sql`, `src/lib/leads/ingest.ts` (extracted from
`lib/bolna/lead-merge.ts`, no behaviour change), `src/lib/intake/{source,events}.ts`,
`src/actions/lead-intake.ts`, `/integrations` with a tab per integration, connection
cards moved off Settings.

### Phase 1 — Google Ads — ✅ built

`src/lib/intake/google-ads.ts` (+20 tests), `/api/webhooks/google-ads/[token]`, default
column map, test-lead handling, delivery log with raw payloads and re-run.

**⚠️ Not live until the two migrations are applied.** Until then `/integrations` shows
the Google Ads tab and the Create button fails — the tables do not exist.

**Then, to verify end to end:** create the endpoint, paste URL + key into a lead form,
press *Send test data* → a `Test` row appears in the log and no lead is created. A real
submission creates a lead whose custom questions are already registered as lead fields.

### Phase 2 — 99acres / portals — ✅ built

`src/lib/intake/portal.ts` + `keys.ts` (+31 tests), `/api/webhooks/portal/[token]`
(POST **and** GET), the learn-from-deliveries field-map editor, per-source IP allowlist,
replay extended to portal deliveries.

Built to survive not having a schema, because none exists:

- **Three encodings accepted** — JSON, form-encoded, and query string, merged, with the
  body winning over the query. Content type is not trusted: a JSON body labelled
  `text/plain` still parses, because losing an enquiry to a header would be absurd.
- **Aliases, separator- and case-blind.** `Mobile__c`, `mobile_no`, `MOBILE NO.` and
  `contactNumber` all resolve to phone. **`price`/`budget` is deliberately NOT aliased** —
  on a property portal that is either the buyer's budget or the listing's asking price,
  and a wrong guess writes a number a salesperson acts on. It lands as a labelled custom
  field instead.
- **Nothing is ever dropped.** Unrecognised fields become custom fields under their own
  name; a body we cannot decode at all is stored as `failed` with the raw bytes and is
  replayable once the decoder or the map is fixed.
- **No phone → still a lead**, flagged with `custom_data.portal.missing_phone`, which is
  filterable on the leads table and bindable on the sheet with no display code.

**Blocked from going live by** the client's RM registering the URL, and one test enquiry —
which is now a feature rather than a blocker: the first delivery populates the mapping
table, which is how that account's field names get learned.

### Phase 3 — WhatsApp CTWA — ✅ built

`src/lib/intake/whatsapp.ts` (+18 tests), `/api/webhooks/whatsapp/[token]` (GET handshake
+ signed POST), referral extraction, the ad-referred-or-first-time-sender rule, and
`/admin/organisations/[id]/integrations` for the credentials.

Decisions taken during the build, all visible in code:

- **Ad context overwrites.** `custom_data.whatsapp` always describes the most recent ad
  they responded to — the one a salesperson should open with. Full history stays in the
  delivery log.
- **Only acted-on messages are logged.** WhatsApp traffic is mostly conversation; a row
  per message would turn the log into an inbox with a raw payload on every line.
- **Closed leads reopen.** A `won`/`lost` lead who taps a new ad goes back to `new`.
- **The WhatsApp display name never overwrites an existing name** — it is user-chosen and
  is a shop name or an emoji string as often as a person's. It seeds new leads only.

**Blocked from going live by** (all customer-side, none of it code): their Meta app,
System User permanent token, app secret, a number not already on another BSP, and the Ads
Attribution toggle. The admin page lists these as a checklist.

---

## 10. What we need from outside the code

### Per client, Google Ads

- Access to the Google Ads account (or a person who has it) to paste URL + key into each
  lead form asset. No cost, no OAuth, no developer token.

### Per client, 99acres

- Seller/builder account with lead API access.
- RM to register and whitelist our webhook URL.
- **One sample payload from a live enquiry** — the hard blocker. Nobody publishes the
  schema.
- IP ranges 99acres posts from, if they'll share them.

### Per client, WhatsApp

- A Meta Business account with **Business Verification completed**.
- A Meta app (type: Business) with WhatsApp added.
- A WABA + phone number, **not already connected to KwikEngage or any other BSP** — a
  number delivers webhooks to exactly one app.
- A **System User permanent access token** (not the 24h temporary one).
- The app secret.
- **Ads Attribution enabled** in WhatsApp Manager.
- A Meta ad account running CTWA campaigns pointed at that number.

This is a real onboarding burden and should become a checklist in the Integrations UI, not
a support email.

---

## 11. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Client's WhatsApp number is already on a BSP | Phase 3 blocked entirely for them | Check at onboarding, before promising CTWA. A number can be migrated off a BSP, but it costs a support cycle and downtime. |
| Ads Attribution left off | Leads arrive with no ad attribution, silently | Surface "N inbound, 0 attributed" on the WhatsApp tab. |
| 99acres changes field names | Leads land as `failed` | Raw payloads stored + replay + editable field map. Recoverable in minutes, not a redeploy. |
| Google webhook returns 200 on a failed write | Lead lost permanently, no retry | Explicit 5xx path. Worth a test. |
| Duplicate leads across channels | Same person from Google *and* 99acres | Phone dedupe already handles it — they merge into one lead. Source becomes first-touch; note this in the UI so it doesn't read as a bug. |
| Refactoring `lead-merge.ts` | Breaks live voice ingest | Extract-and-delegate only, no behaviour change; existing tests are the gate. Do it in Phase 0, alone, and verify before any channel work. |

---

## 12. Open items

- Whether to send Meta Conversions API events back with `ctwa_clid` (closes the ad
  optimisation loop). Deferred, but the field is captured from day one so it stays
  possible.
- Whether first-touch or last-touch wins when a lead arrives from two channels. Currently
  first-touch by accident of find-or-create. Should be a deliberate choice.
- Embedded Signup (Skelo as Meta Tech Provider) once more than ~5 clients need WhatsApp —
  the per-client Meta app setup does not scale past that.

---

## Sources

- [Google Ads lead form webhook — implementation](https://developers.google.com/google-ads/webhook/docs/implementation)
- [Google Ads lead form webhook — samples](https://developers.google.com/google-ads/webhook/docs/samples)
- [Setting up a webhook for a lead form (Google Ads Help)](https://support.google.com/google-ads/answer/16729613)
- [Tracking Click-to-WhatsApp ROI with ctwa_clid](https://whapi.cloud/blog/track-click-to-whatsapp-ctwa-clid)
- [WhatsApp webhook events and notifications (360dialog)](https://docs.360dialog.com/docs/waba-basics/webhook-events-and-notifications)
- [99acres integration (LeadSquared)](https://www.leadsquared.com/99acres-integration/)
- [99acres push-lead API shape (Anarock)](https://support.anarock.com/support/solutions/articles/35000226722-99acres-push-integration)
- [99acres auto lead capture (Corefactors)](https://www.corefactors.ai/blogs/99-acres-integration-and-auto-lead-capture)
