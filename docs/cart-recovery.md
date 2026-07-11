# Cart Recovery

The plain-English sections below explain the feature and the per-client
**[onboarding process](#going-live-setup-checklist)**. For engineers, the
**[Technical integration](#technical-integration-how-it-actually-works)** section is
the authoritative reference for the data flow, the agent variables, and ROI
attribution.

## Contents

**Overview & plan**

- [What we're building](#what-were-building)
- [Where it lives in the app](#where-it-lives-in-the-app)
- [Who sets it up, and who tunes it](#who-sets-it-up-and-who-tunes-it)
- [How it works, step by step](#how-it-works-step-by-step)
- [What the shopper hears on the call](#what-the-shopper-hears-on-the-call)
- [What each client gives us (one-time setup)](#what-each-client-gives-us-one-time-setup)
- [What each client can configure](#what-each-client-can-configure)
- [Who we call (and who we don't)](#who-we-call-and-who-we-dont)
- [How we keep it safe and reliable](#how-we-keep-it-safe-and-reliable)
- [What's built (all of it)](#whats-built-all-of-it)

**Technical integration** — [overview](#technical-integration-how-it-actually-works)

- [End-to-end flow](#end-to-end-flow)
- [Data model](#data-model)
- [Conversation context (agent variables)](#conversation-context-what-we-send-the-agent)
- [The offer discount (auto-sourced)](#the-offer-discount-auto-sourced)
- [Recovered = strict ROI attribution](#recovered--strict-roi-attribution)
- [The dashboard](#the-dashboard)
- [Visibility elsewhere in the app](#visibility-elsewhere-in-the-app)
- [Security & tenancy](#security--tenancy)
- [Files at a glance](#files-at-a-glance)

**Onboarding & operations**

- [Going live: setup checklist](#going-live-setup-checklist)
- [How to test it](#how-to-test-it)
- [Still to confirm](#still-to-confirm)
- [A couple of terms, explained](#a-couple-of-terms-explained)

## What we're building

When a shopper on a client's Shopify store adds items, starts to buy, but leaves
without paying, our voice agent calls them a little later. The agent reminds them
what they left behind, answers questions, and offers a small deal (a discount or a
freebie) to bring them back to finish the purchase.

We're building this so it works the same way for every client we onboard — not a
one-off for a single store.

## Where it lives in the app

Cart Recovery sits under **Campaigns**, in a new **Templates** area. Think of
Templates as ready-made campaign types for specific industries — Cart Recovery is
the first (for online stores), and later we can add others (for example,
finance/BFSI follow-ups).

The difference from a normal campaign: a normal campaign is a one-time list you
upload and run. Cart Recovery is **always on** — it quietly watches for abandoned
carts and calls them automatically. So its page looks like a **live dashboard**
(how many carts, how many recovered, how much revenue came back) with three tabs —
**Abandoned**, **Converted**, and **Call history** — plus **Start / Stop** and
**Export** controls, not an upload-and-run screen. Once it's switched on, a **Cart
Recovery** shortcut also appears under Campaigns in the sidebar. Each future
template can have its own shape; Templates is just the shelf they sit on.

## Who sets it up, and who tunes it

- **We (Skelo) handle the technical connection** to each store — linking it,
  switching it on, and setting up the listeners.
- **The client controls the levers** — the offer (discount or freebie) and the
  timing (how long to wait, how many tries) — from their own Cart Recovery page.

For now, each client sets up their **own small Shopify app** and hands us its keys
(see below). Later, once we have several clients, we can switch to **one shared
Skelo app** that every store just approves — same result, even less setup — but
the per-client approach is fine to start with.

## How it works, step by step

1. A shopper starts checkout on the client's store and enters their phone number,
   but doesn't complete the purchase.
2. Shopify automatically tells us this happened (we don't have to keep asking — the
   store notifies us the moment it occurs).
3. We save that shopper as a lead, along with what was in their cart.
4. We **wait a set amount of time** (for example, 30–60 minutes) in case they come
   back on their own.
5. If they still haven't bought, our voice agent **calls them** — but only within
   the client's **calling window** if one is set (see below) — mentions the items
   they left, and offers the deal the client chose.
6. **The moment we actually reach the shopper** (they answer the call), we mark
   them contacted and **don't call again**, even if more retries were scheduled.
7. If the shopper completes their purchase at any point, the store tells us, and we
   **cancel the call** so we never bother a customer who already bought.

## What the shopper hears on the call

For every recovery call we hand the voice agent a set of **context values** about
that specific cart. The agent can naturally talk about:

- The shopper's **name**.
- The **product they left** — the highest-value item leads; if there's more than
  one it becomes "…and others."
- The **cart total**, the **discounted total** after the offer, the **amount they
  save**, and the **discount name/percentage/code**.
- A **link to finish** the purchase.

Important: these values are only *spoken* if the agent's script references them.
See **[Technical integration → Conversation context](#conversation-context-what-we-send-the-agent)**
for the exact variable names and how to wire them into the agent script.

## What each client gives us (one-time setup)

Every client has their own Shopify app. From it we need just two things:

- The app's **API key** and **API secret key**.
- Their **store address** (the `something.myshopify.com` name).

We also ask them once, in their app's settings, to allow our **callback address**
and turn on the permissions we need. Then, on our admin screen, we save those keys
and click **Authorize with Shopify** — the store approves once, and the actual
access pass is fetched and stored **automatically** (nothing to copy by hand, which
is the part that wasn't working manually). Each client's keys are stored separately
and securely, so one client can never see or affect another.

## What each client can configure

On the same admin screen, per client:

- **How long to wait** before the recovery call.
- **How many times to try** if the first call isn't answered, and how far apart.
- **The calling window** — an optional daily time range (in **IST**) so shoppers are
  only called during set hours; a call that falls due outside it waits until the
  window next opens. Leave it blank to call any time.
- **The offer** to give — chosen from the client's own Shopify data, either:
  - a **discount code** (e.g. SAVE10), or
  - a **free product** from their catalogue.

## Who we call (and who we don't)

- We call **every cart that left a phone number**, regardless of whether the shopper
  ticked the marketing/consent box. The consent value **is still recorded** on each
  row (so it can be filtered/reported on later), it just no longer blocks the call.
  > ⚠️ Compliance note: calling non-consented shoppers can run into telemarketing /
  > DND rules (TCPA in the US, DLT/DND in India). This is a deliberate business
  > choice by the store owner; the consent flag is preserved on every attempt if
  > you ever need to filter by it.
- A cart is **skipped** (recorded, not dialled) only for two reasons: **no phone**
  on the checkout, or **no voice agent** configured/enabled for the org.
- For the first version we do **voice calls only**. Text/WhatsApp follow-up can be
  added later if wanted.
- If a shopper already bought, we **cancel** any pending call so we never bother a
  customer who already purchased.

## How we keep it safe and reliable

- **Each client is fully separate.** We always work out which store a message
  belongs to on our side — we never take the store's word for it.
- **Secrets stay on our servers**, never exposed to any browser.
- **No double-calling.** Even if the store sends us the same notice twice, we only
  ever schedule one recovery per cart, and we cancel it the instant the order
  completes.
- **Reach once, then stop.** As soon as a shopper actually answers, the attempt is
  marked contacted (`connected_at`) and no further calls go out — reaching them is
  the whole job, so retries never dial a customer we've already spoken to.
- **Built on what we already have.** The calling, scheduling, and retry machinery is
  the same proven system we already use for our other call features — we're plugging
  Shopify into it, not building a second system.

## What's built (all of it)

Everything below is implemented end-to-end:

1. **Connect a store** — the admin screen to enter a client's keys and mark them
   connected.
2. **Listen for abandoned carts** — receiving the store's notifications safely,
   with the genuineness (signature) check on every message.
3. **Schedule the recovery** — turning an abandoned cart into a planned call (wait
   time, no-double-call rules). Captures the shopper's name, email, phone, cart, and
   consent flag. Calls every cart with a phone (consent recorded, not gating).
4. **Make the call** — the agent rings the shopper with the full cart + offer
   context (see below), and retries per the client's settings; it stops if they buy.
5. **Offers** — the client picks the discount from a **Shopify dropdown**; we
   auto-capture the discount **percentage/amount** from the price rule and
   auto-fill the redeemable **code**, so the agent can quote a real discounted total.
6. **Dashboard** — three tabs (**All carts / Converted / Call history**) with
   pagination, a "callable only" filter, per-call detail drawer (recording +
   transcript + extracted data), and headline stats with **strict ROI attribution**.
   The **All carts** tab carries a **Cart** column badging each cart's outcome
   (**Abandoned / Recovered · by us / Recovered · organic**), and call statuses use
   **event-based colors** (green = in call, blue = connected, red = failed, etc.).
7. **Lifecycle controls** — **Start / Resume / Stop** (Stop also cancels queued
   calls) and **CSV export**, plus a **Cart Recovery sidebar sub-item** shown only
   while the feature is switched on.
8. **Calling window** — an optional per-org daily time range (IST); the dispatcher
   defers out-of-window calls to the next window open instead of dropping them.
9. **Voice agent card** — a read-only summary on the recovery page showing the
   connected agent's name and the number calls are placed from.
10. **Visibility elsewhere** — a read-only **Shopify store** card on the owner's
    Settings page (store link, API version, scopes, status), and a **Cart Recovery
    source** in the admin analytics builder for charting abandoned/recovered carts
    and cart value.

Not yet done: automated tests for the call-retry decisions (the calling-window,
security + cart reading are tested), and the optional switch to one shared Skelo app.

## Technical integration (how it actually works)

This section is the engineering reference — the plain-English plan above is the
"what," this is the "how." Provider naming note: the product always says **"voice
agent"**; internally the current provider is Bolna (code lives under
`services/`/`lib/bolna/`).

### End-to-end flow

```
Shopify store
   │  checkouts/create · checkouts/update · orders/create   (signed webhooks)
   ▼
POST /api/webhooks/shopify        app/api/webhooks/shopify/route.ts
   │  1. verify HMAC with THAT store's api_secret
   │  2. resolve org from the shop domain (never the payload)
   │  3. ack fast, do work in after()
   ├── checkouts/* → scheduleRecoveryFromCheckout()   lib/shopify/recovery.ts
   └── orders/create → cancelRecoveryForOrder()        lib/shopify/recovery.ts
        └─ sets converted_at, cancels a pending/in-flight attempt

scheduleRecoveryFromCheckout()
   │  normalizeAbandonedCheckout()  lib/shopify/webhooks.ts
   │    → phone, email, name, cart_total, currency, recovery_url, consent,
   │      line items {title, quantity, lineValue}
   │  gate: no phone → skipped(no_phone); no voice agent → skipped(no_voice_agent)
   │  snapshot the offer (label, code, discount value + kind) from settings
   │  find-or-create the lead; insert shopify_recovery_attempts row (pending)
   ▼
Cron tick  POST /api/cron/campaigns/tick   (x-cron-secret; ~once a minute)
   │  dispatchDueRecoveries()  lib/shopify/recovery.ts
   │    calling-window gate: rows outside their org's window are deferred to the
   │      next window open (isWithinCallWindow / nextCallWindowOpen, IST)
   │    CAS-claim the row (pending → in_flight), build the agent variables,
   │    initiateBolnaCall(user_data), insert a calls row, apply retry rules
   ▼
Bolna places the call → status + post-call webhooks
   │  applyCallStatusUpdate()  lib/bolna/status-update.ts   (lifecycle events)
   │  recordOutboundResult()   lib/bolna/outbound.ts        (final: transcript…)
   └─ applyShopifyRecoveryOutcome()  advances the attempt:
        · connect (answered OR completed) → succeeded + connected_at, never re-dialled
        · technical miss (no_answer / busy / failed) → retries under the cap
        · order placed (orders/create) → canceled + converted_at
        · WhatsApp release: connected call ENDED (completed), or voice exhausted
          with no connect → re-anchor whatsapp_next_at = now (next tick sends it)
```

### Data model

- **`shopify_recovery_settings`** (one row per org) — the levers: `enabled`,
  `wait_minutes`, `max_attempts`, `retry_interval_seconds`, `agent_id`, the
  offer (`offer_type`, `offer_code`, `offer_label`, `offer_discount_value`,
  `offer_discount_kind`), and the optional **calling window**
  (`call_window_start`, `call_window_end` — tz-naive `time`s evaluated in
  `APP_TIMEZONE`/IST; both null → dial around the clock).
- **`shopify_recovery_attempts`** (one row per `(org, checkout_token)`) — the queue
  + activity log. Holds the cart snapshot (`customer_name`, `email`, `phone`,
  `marketing_consent`, `cart_total`, `currency`, `cart_items`, `recovery_url`),
  the offer snapshot, the state machine (`status`, `attempt`, `next_attempt_at`,
  `scheduled_at`, `canceled_at`, `converted_at`, `connected_at`), and links
  (`lead_id`, `last_call_id`). `status ∈ pending | in_flight | succeeded | failed |
  canceled | skipped`; `connected_at` is stamped the first time a dial is answered
  or completes (→ `succeeded`, no further dials). Unique `(organisation_id,
  checkout_token)` makes webhook retries idempotent (no double-calling).
- **`calls.shopify_recovery_attempt_id`** — the seam back from the dial pipeline;
  lets a call outcome advance the recovery attempt.
- **`whatsapp_integrations`** (one row per org) — the WhatsApp BSP connection:
  `provider` (default `kwikengage`), `api_token`, `base_url`, `sender_id`,
  `template_name`, `enabled`. RLS with no authenticated policies (service-role
  only), like `bolna_integrations`.
- **`shopify_recovery_messages`** (WhatsApp send ledger, the WhatsApp analogue of
  `calls`) — `shopify_recovery_attempt_id` seam, `to_phone`, `template_name`,
  `provider`, `provider_message_id`, `status ∈ queued|sent|delivered|read|failed`,
  timestamps. Unique `(organisation_id, provider_message_id)` makes delivery
  webhooks idempotent.

### Channels: voice + WhatsApp

Cart recovery can work a cart over **two channels on the same attempt row** — a
voice call (Bolna) and a WhatsApp message (KwikEngage BSP). WhatsApp is a
**parallel track** on `shopify_recovery_attempts` (`whatsapp_status`,
`whatsapp_attempt`, `whatsapp_next_at`, `whatsapp_sent_at`,
`last_whatsapp_message_id`, `whatsapp_skip_reason`), drained by
`dispatchDueWhatsAppRecoveries()` (`lib/shopify/whatsapp-recovery.ts`) on the
same cron tick. The voice state machine is untouched.

- **Config** (`shopify_recovery_settings`): `voice_enabled`, `whatsapp_enabled`
  (default off — existing orgs stay voice-only), `whatsapp_template_name`
  (optional override of the integration default). There is no channel-ordering
  choice: voice always dials first, WhatsApp follows the call.
- **Scheduling** (`scheduleRecoveryFromCheckout`): the voice call fires at
  `now + wait_minutes`. When both channels are on, WhatsApp is **held behind the
  voice track** — its `whatsapp_next_at` is stamped to a backstop
  (`now + wait_minutes + max_attempts × retry_interval_seconds`) so a dropped
  provider webhook can't strand it. It is **released** (re-anchored to `now`, so
  the next tick sends it) by `applyShopifyRecoveryOutcome` the instant the
  connected call ends (`completed`) — never on `in_progress`, so we don't message
  a shopper mid-call — or when voice gives up (a non-connect terminal on the last
  attempt), which is the no-connect fallback. If WhatsApp is on but voice isn't
  actionable (no agent), it sends on its own at `now + wait_minutes`. Conversion
  (`converted_at`) cancels a still-held WhatsApp.
- **Template-gated & configurable:** WhatsApp needs a Meta-approved template.
  Until `template_name` is set the WhatsApp track is `skipped` (`no_template`)
  and voice still runs. The send call is wired to **KwikEngage**:
  `POST {base}/send-message/v2` with `Authorization: <api key>` (raw), `to` as
  the international number without `+`, `type:"template"`, and body variables
  mapped into Meta-style `content.template.components`. Response is
  `{status:"success", message_id_attr}` (the id is read leniently via
  `extractMessageId`, which also accepts `messageId`/`data.*` shapes). The
  endpoint/payload + positional variable order (`TEMPLATE_VARIABLE_ORDER`) live
  in ONE place — `lib/kwikengage/client.ts` `buildTemplateRequest()`. Variables
  come from the shared `buildRecoveryVariables()`. Base URL default
  `https://api.kwikengage.ai` (override per-org via the integration's
  `base_url`). **Param hygiene:** each body parameter is sanitised
  (`sanitizeTemplateParam` — whitespace collapsed, trimmed, blank → `-`) because
  Meta rejects empty/newline/tab params with a generic 400; blank source keys are
  logged (names only) for diagnosis.
- **Provider-agnostic:** a `provider` column + `lib/whatsapp/registry.ts` mean a
  different org can use a different BSP later — add an adapter + webhook route,
  no schema change.
- **Consent:** message everyone with a phone (consent recorded, not gating) —
  same policy as voice. `delivered`/`read` are informational; only `converted_at`
  (the order webhook) stops the sequence, which also cancels the WhatsApp track.
- **Triggers:** automatic (cron, like voice) **and** a manual bulk
  `sendWhatsAppToAbandonedCarts()` ("Send WhatsApp" control) that queues eligible
  carts for the next tick.
- **Delivery webhook:** `POST /api/webhooks/kwikengage` (shared secret via
  `x-kwikengage-signature` header or `?secret=`) → `applyWhatsAppDeliveryUpdate()`
  advances the ledger row + track (monotonic, idempotent by
  `provider_message_id`). Inbound replies are out of scope for v1.

### Conversation context (what we send the agent)

Built by `buildRecoveryVariables()` in `lib/shopify/recovery.ts` and passed as
Bolna's `user_data` on `POST /call`. **Each key maps 1:1 to a `{placeholder}` in
the agent's Bolna prompt** — the agent only speaks a value whose `{name}` is in the
script; extra keys are ignored. All values are flat strings (empty `""` when
unknown, so the prompt never renders a literal `{name}`).

| Variable | Example | Notes |
| --- | --- | --- |
| `{customer_name}` | `Asha` | **first name only** — "Asha", not "Asha Rao" |
| `{top_product}` | `Diamond Ring` | highest line value in the cart |
| `{cart_summary}` | `Diamond Ring and others` | "…and others" when >1 product |
| `{item_count}` | `3` | distinct products |
| `{currency}` | `INR` | |
| `{cart_total}` | `5000` | original cart total — **whole units, no paise** |
| `{discount_name}` | `20% off your order` | offer label |
| `{discount_code}` | `COMEBACK20` | redeemable code |
| `{discount_percentage}` | `20%` | percentage offers only |
| `{discount_amount}` | `1000` | computed from the offer (whole units) |
| `{discounted_cart_total}` | `4000` | `cart_total − discount_amount` (whole units) |
| `{recovery_url}` | `https://…` | finish-checkout link |

Currency values are rounded to whole units (`wholeAmount()`) so the agent quotes
"5000 rupees", never "4999.50" — the same values flow into the WhatsApp template.

Internal IDs (`organisation_id`, `shopify_recovery_attempt_id`, `lead_id`) are also
sent for traceability but aren't meant to be spoken.

### The offer discount (auto-sourced)

The client picks a discount from a dropdown of the store's **price rules**
(`listDiscountOffers`, `lib/shopify/client.ts`). Selecting one:

- captures the numeric **value + kind** (`percentage` / `fixed_amount`) from the
  price rule and persists them on settings (`offer_discount_value/kind`);
- auto-fills the redeemable **code** via `getDiscountCodeForRule` /
  `getShopifyOfferCode`.

At dispatch, `discount_amount` and `discounted_cart_total` are computed from the
snapshotted value (percentage → `total × pct/100`; fixed → `min(value, total)`).
A hand-typed label with no matching rule simply has no numeric discount — the agent
still quotes the cart total, just no "you save X."

### Recovered = strict ROI attribution

A conversion counts toward the **Recovered / revenue** stats only when a recovery
call actually **completed** (we reached the shopper) **and that call ended before**
the order was placed (`attributedAttemptIds` in `actions/shopify-recovery.ts`). Any
other conversion (bought before we called, never connected) is shown as
**Organic** on the Converted tab and excluded from ROI. `converted_at` itself is
set by the `orders/create` webhook matching the checkout token.

**Reach-once, then stop** (`applyShopifyRecoveryOutcome`): "connected" means the
dial was **answered** (`in_progress`) or **completed** — either signal stamps
`connected_at`, flips the attempt to `succeeded`, and stops all further dials. Only
genuine non-connects (`no_answer` / `busy` / initiation `failed`) re-arm for a
retry under the cap. Keying the stop on *answered* (not just a clean `completed`)
means an answered-then-dropped call still counts as reached. A converted cart is
likewise never re-dialled — `cancelRecoveryForOrder` cancels the pending attempt,
and the dispatcher additionally skips any row with `converted_at` set.

### The dashboard

- **Stats** (`getRecoveryOverview`): Carts abandoned (actioned, excludes skipped),
  Calls made, **Cart Recovered** (every conversion — call-driven **and** organic,
  `conversions_total`), and **Revenue recovered** (cart value across **all**
  recovered carts, not just the attributed ones). The strict-ROI split
  (`recovered` = attributed count) is still computed and kept in the DB, just not
  shown as its own headline card. `getRecoveryOverview` also returns a read-only
  **voice agent** summary (agent label from `voice_agents`, caller number from
  `bolna_integrations`) rendered by `RecoveryAgentCard` — never names the provider.
- **Tabs** (`CartRecoveryWorkspace`), each paginated (`getAbandonedCarts`,
  `getConvertedCarts`, `getRecoveryCalls`, 20/page) and **live** (Supabase
  realtime on `shopify_recovery_attempts` + `calls`, debounced):
  - **All carts** — every cart (converted or not); "callable only" filter hides
    skipped/no-phone. Columns: phone, cart value, products, offer, a **Cart**
    outcome badge (**Abandoned / Recovered · by us / Recovered · organic**, via
    `CartOutcomeBadge` + `attributedAttemptIds`), a combined **Reach-out** status
    (`ReachOutStatusBadge` — **Closed ✓** when a call connected or WhatsApp sent;
    **Failed** if either channel failed, naming which; **Scheduled** while queued),
    and abandoned / next-call timestamps. Per-cart **Attempts** and **WhatsApp**
    detail live in the cart drawer, not as table columns.
  - **Converted** — recovered-at time (the per-row Call-driven/Organic column was
    removed; attribution is still in the DB + the drawer's outcome badge).
  - **Call history** — one row per dial, status shown with an event-based colored
    badge (`CallStatusBadge`); a row opens a **detail drawer** with the recording
    player, full transcript, extracted lead fields, and the cart. The drawer stays
    live while open (re-derives from the refreshed row).
- **Controls** (`CartRecoveryControls`): Start/Resume (`setRecoveryRunning(true)`),
  Stop (`setRecoveryRunning(false)` — also cancels queued attempts), Export CSV
  (`exportRecoveryAttempts`).
- **Sidebar**: a **Cart Recovery** sub-item under Campaigns, shown only when
  `isCartRecoveryActive()` is true (i.e. recovery is switched on).

### Visibility elsewhere in the app

- **Owner Settings → Shopify store** (`components/app/shopify-status-card.tsx`,
  fed by `getShopifyStatus()` in `actions/shopify.ts`) — a read-only card on the
  org settings page showing the linked store's general details: **clickable store
  domain**, API version, granted **access scopes (as badges)**, last-updated, and a
  status badge (**Connected / Awaiting authorization / Paused / Not connected**).
  Secrets are redacted; connecting/authorizing stays an admin action.
- **Admin analytics builder → "Cart Recovery" source** — the dashboard widget
  builder can chart `shopify_recovery_attempts`. The logical source `recovery`
  maps to that table in the execution RPC. Available fields:
  - **Dimensions / group-by:** status, skip reason, currency, abandoned-at
    (`created_at`), recovered-at (`converted_at`) — the two dates are
    time-bucketable (day/week/month).
  - **Filters:** the above + marketing consent, cart value.
  - **Metrics:** cart rows (count), **cart value** (sum/avg — revenue), call
    attempts.
  - Wiring spans the TS catalog (`actions/admin/dashboard-catalog.ts`), the source
    enum/type, the builder's source guard, and the SQL allowlists +
    source→table map in migration `20260702000000_dashboard_recovery_source.sql`.
  - Note: "recovered vs not" is expressed via the **status** dimension/filter
    (e.g. `succeeded`); there's no boolean "converted" column, and the builder's
    filter ops don't include is-null/not-null.

### Security & tenancy

- Every webhook HMAC is verified with **that store's own `api_secret`**; the org is
  resolved from the shop domain server-side, never trusted from the payload.
- Secrets (`api_secret`, `access_token`, Bolna key) live only in server runtime.
- `shopify_recovery_settings` / `shopify_recovery_attempts` are owner-readable via
  RLS; all writes go through the service-role client after ownership checks.

### Files at a glance

| Area | File |
| --- | --- |
| Webhook entry | `app/api/webhooks/shopify/route.ts` |
| Normalize + HMAC | `lib/shopify/webhooks.ts` |
| Schedule / dispatch / outcome | `lib/shopify/recovery.ts` |
| WhatsApp dispatch + delivery outcome | `lib/shopify/whatsapp-recovery.ts` |
| WhatsApp provider seam + registry | `lib/whatsapp/provider.ts` · `lib/whatsapp/registry.ts` |
| KwikEngage client + webhook parse (+ test) | `lib/kwikengage/client.ts` · `webhook.ts` · `ip-allowlist.ts` |
| WhatsApp delivery webhook | `app/api/webhooks/kwikengage/route.ts` |
| WhatsApp integration (connect) | `actions/whatsapp-integrations.ts` · `components/app/whatsapp-integration-card.tsx` |
| Calling-window logic (+ tests) | `lib/shopify/call-window.ts` · `call-window.test.ts` |
| Shopify Admin client (price rules, codes, webhooks) | `lib/shopify/client.ts` |
| Bolna call client + lifecycle | `lib/bolna/client.ts` · `lib/bolna/outbound.ts` · `lib/bolna/status-update.ts` |
| Server actions (settings, tabs, controls, export) | `actions/shopify-recovery.ts` |
| Org Shopify status (read-only) | `actions/shopify.ts` · `components/app/shopify-status-card.tsx` |
| Admin analytics source | `actions/admin/dashboard-catalog.ts` · `lib/validations/dashboard-widget.ts` |
| Dashboard UI | `components/app/cart-recovery-*.tsx`, `recovery-call-detail.tsx` |
| Status/outcome badges · voice agent card | `components/app/recovery-badges.tsx` · `recovery-agent-card.tsx` |
| Page | `app/(app)/campaigns/templates/cart-recovery/page.tsx` |
| Migrations | `supabase/migrations/2026062*_shopify*.sql`, `20260630*/20260701*_recovery_*.sql`, `20260702*_{dashboard_recovery_source,recovery_realtime,recovery_abandoned_at}.sql`, `20260703000000_recovery_connected_at.sql`, `20260703000001_recovery_call_window.sql`, `20260704000000_recovery_whatsapp.sql`, `20260711000000_recovery_drop_channel_ordering.sql`, `20260711000001_whatsapp_template_language.sql` |

## Going live: setup checklist

**Once, on our side:**

- Set `SHOPIFY_APP_URL` to `https://app.skelo.team` (used to build the callback
  address the store approves during Authorize).
- Set `SHOPIFY_WEBHOOK_ADDRESS` to `https://app.skelo.team/api/webhooks/shopify`
  (the address Shopify sends alerts to; the "Register webhooks" button uses it).
- Ensure `CRON_SECRET` is set (guards the once-a-minute dispatch tick).
- For WhatsApp: set `KWIKENGAGE_WEBHOOK_SECRET` (the delivery-webhook shared
  secret); optionally `KWIKENGAGE_API_BASE_URL` and `KWIKENGAGE_WEBHOOK_ALLOWED_IPS`.
- Apply the database changes: `npx supabase db push`. The recovery feature spans
  the `shopify_*` migrations plus the recent additive ones — offer discount
  (`offer_discount_value/kind` on settings + attempts), `email`, and
  `marketing_consent` on `shopify_recovery_attempts`;
  `20260702000000_dashboard_recovery_source.sql` (admin analytics `recovery`
  source); `20260702000001_recovery_realtime.sql` (publishes the tables for live
  dashboard updates); `20260703000000_recovery_connected_at.sql` (the reach-once
  marker); `20260703000001_recovery_call_window.sql` (the calling-window
  columns); `20260704000000_recovery_whatsapp.sql` (the WhatsApp channel, ledger,
  and settings); and `20260711000000_recovery_drop_channel_ordering.sql` (drops
  `first_channel` + `escalation_gap_minutes` now that voice always leads and
  WhatsApp fires when the connected call ends); and
  `20260711000001_whatsapp_template_language.sql` (per-org `template_language` on
  `whatsapp_integrations`, default `en`).

**Per client:**

1. **Connect the store** (us) — paste the store address + API key + API secret on
   the admin Cart Recovery screen, **Save**, then click **Authorize with Shopify**
   (the store approves once and we get the access pass automatically).
2. **Register webhooks** (us, one button) — tells Shopify to start sending that
   store's abandoned-cart alerts.
3. **Tune + turn on** (client) — on their Cart Recovery page, set the wait time and
   attempts, pick the offer from the **Shopify dropdown** (so the discount % and
   code are captured for the call), then hit **Start**.
4. **Wire the agent script** (one-time, per client) — the voice agent's Bolna
   prompt must reference the `{placeholders}` from
   [Conversation context](#conversation-context-what-we-send-the-agent) — e.g.
   `{customer_name}`, `{cart_summary}`, `{cart_total}`, `{discounted_cart_total}`,
   `{discount_code}`. We send the data regardless, but the agent only *says* the
   variables the script mentions.
5. **WhatsApp (optional channel)** — in **Settings → WhatsApp**, connect the API
   token, sender, the **Meta-approved template name**, and the **template
   language** (the Meta language code the template was approved under, e.g. `en`
   or `en_US` — it must match exactly or the BSP rejects the send). In the BSP
   dashboard
   (KwikEngage → Integrations → Webhook), point the delivery webhook at
   `https://app.skelo.team/api/webhooks/kwikengage?secret=<KWIKENGAGE_WEBHOOK_SECRET>`.
   Then on the Cart Recovery page enable **WhatsApp** under Channels. Voice always
   calls first; WhatsApp is sent once the connected call ends (or as a fallback if
   voice never connects) — there's no ordering or gap to configure. Without an
   approved template the WhatsApp track is skipped and voice still runs. The
   template's positional variable order is set in `lib/kwikengage/client.ts`
   (`TEMPLATE_VARIABLE_ORDER`).
6. **Validate the connection** (admin) — the admin WhatsApp form has a **Send
   test** button (`sendTestWhatsAppAdmin`) that fires one real template send, with
   sample values, to any number. It uses the **saved** config, so save first. A
   rejection surfaces the provider's exact error (bad template name, wrong
   language, or parameter-count mismatch) instead of failing silently — the fastest
   way to confirm a template is wired correctly before going live. Empty template
   params are sanitised to a non-empty placeholder (Meta rejects blanks with a
   generic 400), and blank source fields are logged by name for diagnosis.

## How to test it

**Quick check (no store needed):** run `npx vitest run src/lib/shopify/`. This
checks the two riskiest pieces — the "is this message really from Shopify?"
signature check, and reading the cart details out of a Shopify message.

**Full end-to-end test (recommended):** you need a free **Shopify development
store** and a **public web address** for our app — either a tunnel (ngrok /
cloudflared pointing at your local app) or a staging deploy — because Shopify has
to be able to reach us.

1. Create a free Shopify development store and add a product.
2. In that store: **Settings → Apps → Develop apps**, create an app with the
   `read_checkouts` and `read_orders` permissions, install it, and copy its
   **access token** and **API secret key**.
3. In our admin → that org's **Cart Recovery** screen → paste the store domain +
   token + secret + API version → **Connect**, then click **Register webhooks**.
4. On the org's **Cart Recovery** page: hit **Start**, set "wait before calling"
   to **1 minute** (so you're not waiting around), and pick an offer from the
   Shopify dropdown (a percentage rule shows a "Discount detected: X% off" hint).
5. In the dev store, go to checkout, **enter a phone number you can answer**, and
   **leave without paying**. (Consent no longer matters — any cart with a phone is
   dialled.)
6. Within a minute or two a row appears on the **Abandoned** tab as **Waiting**. On
   the next background tick (once a minute) the call fires — you should get it. To
   not wait, trigger the tick by hand (below).
7. Go back and **complete the purchase** → it moves to the **Converted** tab, and any
   pending call is canceled. It only counts as **Recovered** in the ROI stats if a
   call actually reached you *before* the purchase (otherwise it shows as
   **Organic**).

**Trigger the call immediately (skip the wait):** the calls are placed by a
once-a-minute background job. To run it on demand, send it a nudge:

```bash
curl -X POST https://app.skelo.team/api/cron/campaigns/tick \
  -H "x-cron-secret: <the CRON_SECRET value>"
```

**What to watch on the dashboard:** on the Abandoned tab rows move **Waiting →
Calling → Reached**; on conversion they move to **Converted**. A **Skipped** row
with a reason (`no phone` / `no voice agent`) means the cart wasn't eligible. If
checkouts arrive but everything is "skipped: no phone," the store's checkout isn't
collecting a phone number.

## Still to confirm

- Do the clients' checkouts actually **capture phone numbers**? That decides how
  many abandoned carts we can call at all.
- Compliance sign-off for calling **non-consented** shoppers per client/region
  (TCPA / DND). The consent flag is recorded on every row if a client wants to
  re-introduce gating.
- Each client's voice agent script needs a **one-time wiring** of the
  `{placeholders}` so it naturally mentions the cart items and the offer.
- For the offer, do we start with **discount codes only**, or also **free products**
  from day one?

## A couple of terms, explained

- **Abandoned cart / checkout:** a shopper who started buying and entered their
  details but didn't pay.
- **Notification from the store:** Shopify can automatically ping our system when
  something happens (like a cart being abandoned), so we react instantly instead of
  polling.
- **Access key / secret:** the credentials a client's store gives us — one to read
  their data, one to prove messages are genuinely from that store.
