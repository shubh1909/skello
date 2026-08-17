---
name: skelo-lead-intake
description: Non-voice lead capture in Skelo — Google Ads lead forms, Click-to-WhatsApp ads via the Meta Cloud API, and property portals (99acres). Covers lead_intake_sources / lead_intake_events, the shared ingest core in lib/leads/ingest.ts, per-channel webhook verification, and the admin provisioning surface. Load this for any task touching /api/webhooks/{google-ads,whatsapp,portal}, /integrations, lead_intake_*, or src/lib/intake/.
---

# Skelo Lead Intake (Google Ads · WhatsApp CTWA · Portals)

Load `skelo-tenancy` alongside — every path here is service-role and must scope by hand.
Load `skelo-leads` when touching the merge, because `leads` is dual-keyed and has a
partial dedupe index.

Built 2026-08-12 → 2026-08-17. Plan and rationale: [docs/integrations-plan.md](../../../docs/integrations-plan.md).

## ⚠️ The voice agent is NOT one of these channels

`skelo-voice-agent` owns `/api/webhooks/bolna/leads`. It has its own contract, its own
per-call snapshot on `calls`, and an intent/score column patch only a conversation
produces. It does **not** route through `ingestNormalisedLead`. Do not "unify" them.

What they *do* share is the core extracted into `src/lib/leads/ingest.ts`:
`findOrCreateLead`, `getLockedFields`, `applyJsonbSnapshot`, `registerDiscoveredFields`.
`lib/bolna/lead-merge.ts` delegates to those. Changing them changes voice ingest — its
tests are the regression gate.

## The pipeline every channel shares

```
1. Receive   → tenant resolved from the URL's public_token. NEVER from the payload.
2. Verify    → per channel (see traps)
3. Record    → lead_intake_events row written BEFORE the ack
4. Normalise → channel adapter → NormalisedLead
5. Ingest    → ingestNormalisedLead()
```

**Step 3 is not optional.** A 200 tells the sender to forget the delivery; everything after
it runs where the sender can no longer hear us fail. Same discipline as
`recordCheckoutEvent` on the Shopify path.

**Step 5 is why a new channel needs no display code.** `register_lead_field` puts every
unseen key in `lead_field_definitions` on first sight, which makes it a selectable
leads-table column and a bindable lead-sheet field immediately.

## Traps

### 1. Google's response contract is the INVERSE of Shopify's

| Status | Meaning to Google |
|---|---|
| `200 {}` | accepted — delivery forgotten |
| `4XX` | **never retried** |
| `5XX` | **retried** |

`src/app/api/webhooks/shopify/route.ts` deliberately 200-acks deliveries it can't use so
Shopify stops retrying. Copying that reflex into the Google route loses a real lead on a
transient DB blip, permanently and silently. **A failed `lead_intake_events` insert must
return 503.** A missing `google_key` on *our* side is also 503 (our misconfiguration — let
them retry until it's fixed), not 4xx.

Google's only authentication is `google_key`, a plaintext secret echoed in the body. There
is no signature. That is why tenancy lives in the URL token: a leaked key alone must not
let an attacker choose whose workspace to write into.

### 2. WhatsApp — resolve the tenant, THEN verify

Each client runs their own Meta app, so `app_secret` differs per org. The signature cannot
be checked until the token has resolved the source. Same order the Shopify route uses.

Read the raw body **once** and hash it as-is — a parsed-and-re-serialised body loses key
order and never matches. `timingSafeEqual` throws on a length mismatch, so length is
checked first; a garbage header must be `false`, not a 500.

### 3. `referral` is fragile, and its absence is silent

- It appears only on the **first** message of a conversation started from a CTWA ad.
- It appears at all only when **Ads Attribution** is enabled on the WABA. If a client
  leaves it off, leads still arrive, every one looks organic, and `ctwa_clid` is lost
  permanently. Nothing in the payload says why. **There is still no UI counter for this**
  — see Known gaps.
- A number delivers webhooks to exactly **one** Meta app. A number already on KwikEngage
  cannot also reach us. Check before promising a client CTWA.

`ctwa_clid` is captured but nothing consumes it yet; it is unrecoverable later, which is
why it is stored now.

### 4. Portals have no schema, and `Content-Type` lies

99acres publishes nothing and field names differ per seller account. So
`decodePortalRequest` accepts JSON, form-encoded and query-string, on **POST and GET**,
merged (body wins over query), and tries JSON even when the header says `text/plain`.

**`price`/`budget` is deliberately NOT aliased.** On a property portal that is either the
buyer's budget or the listing's asking price, and a wrong guess writes a number a
salesperson acts on. It lands as a labelled custom field instead.

`leafOf()` must skip empty segments: a field literally named `MOBILE NO.` breaks
`split(".").pop()`, which silently defeated every phone alias. There is a test pinning it.

### 5. Per-channel lead rules differ, on purpose

| Channel | Creates a lead when | Ingest options |
|---|---|---|
| Google Ads | always, unless `is_test` | defaults |
| WhatsApp | ad `referral` present (even for a known contact), **or** sender unknown | `overwriteName: false`, `reopenClosedStatus: true` |
| Portal | always | `overwriteName: false`, `reopenClosedStatus: true` |

`overwriteName: false` on WhatsApp because the only name available is the sender's own
display name — a shop name or emoji string as often as a person's — and it must never
replace a name heard on a call.

`leads.source` is **first-touch**: written on insert, never on update.

## Tables

- **`lead_intake_sources`** — one row per (org, channel). RLS on, **no authenticated
  policies**: service-role only, it holds secrets. Read through a redacting action.
- **`lead_intake_events`** — one row per delivery. `unique (source_id, external_id) where
  external_id is not null`. Org owners **can** SELECT (the delivery log is customer-facing);
  writes are webhook-side only.

Dedupe keys: Google `lead_id`, WhatsApp `wamid`, portal an id-ish field if one exists,
otherwise null → accept-once.

Migrations `20260813000000` (enum values) and `20260813000001` (tables). The enum migration
is separate because `ADD VALUE` cannot be *used* in the transaction that adds it.

## Provisioning is admin-only

Created and configured at `/admin/organisations/[id]/integrations` behind
`userCanManageOrg`. `/integrations` (customer) is **read-only** — endpoint, delivery log,
re-run. An app secret and a System User token must never sit behind a form every org owner
can reach.

Credential writes go through a per-channel allowlist (`WRITABLE_CREDENTIALS`) and an
unrecognised key is **rejected, not dropped** — a typo'd `app_secrete` that saved cleanly
would leave every signature failing with no clue why. Only Skelo-issued secrets
(`google_key`, `verify_token`) are ever returned to a client; `configured_credentials`
reports client-supplied ones by name only.

`OPTIONAL_CREDENTIALS` exists because every portal credential is optional — a portal signs
nothing — and readiness must not count them, or a portal endpoint sits on "Awaiting
credentials" forever.

## Webhook URLs

Built from `appOrigin()` (`src/lib/app-url.ts`), which prefers `NEXT_PUBLIC_APP_URL` and
falls back to the request host. It reports `reachable: false` for localhost and private
ranges, and the admin page interrupts — these addresses are called from Google's and Meta's
servers, and a localhost URL looks valid while silently receiving nothing.

Distinct from `SHOPIFY_APP_URL`, which exists because Shopify's registered OAuth redirect
must match byte for byte.

## Known gaps (as of 2026-08-17)

- **Migrations `20260813000000`/`20260813000001` are NOT applied.** Nothing here works
  until they are. `NEXT_PUBLIC_APP_URL` is also unset.
- No "N inbound, 0 attributed" counter for the Ads Attribution failure (trap 3).
- No retention sweep on `lead_intake_events`; it grows unbounded.
- Re-run is unavailable for WhatsApp deliveries.
- Portal IP allowlist matches exact strings or dotted prefixes, not CIDR.
- First-touch vs last-touch attribution when one phone arrives from two channels is
  unresolved — currently first-touch by construction.

## Checklist before shipping a change here

- [ ] Right ack semantics for the channel? Google 5xx-on-our-failure, others 200-after-durable.
- [ ] Event recorded **before** the ack?
- [ ] Tenancy from the URL token, never the payload?
- [ ] Service-role query scoped by `organisation_id` **and** `deleted_at is null`?
- [ ] Writing to `leads`? Both `organisation_id` and `org_slug`.
- [ ] Touched `lib/leads/ingest.ts`? Voice-agent tests still pass.
