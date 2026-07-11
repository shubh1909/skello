# Onboarding runbook (admin)

Everything an admin does to bring a new workspace live. **Part A** is the general
setup every org needs; **Part B** adds the Shopify + WhatsApp cart-recovery
stack on top. For the internals behind Part B see
[docs/cart-recovery.md](cart-recovery.md).

- **You (Skelo admin)** provision integrations from the admin console
  (`/admin/organisations/[id]`). Admin access = `profiles.is_admin = true`
  (a DB flag set by an existing admin/engineer). Staff don't have their own
  workspace — admins land on `/admin`.
- **The client (workspace owner)** signs up, creates the workspace, and later
  tunes their own offer/timing. They only ever see **read-only** status cards in
  **Settings** — all connection config lives in the admin console.

---

## Platform prerequisites (one-time, not per client)

Confirm these once for the deployment before onboarding anyone:

- **Database is migrated:** `npx supabase db push` (must include the latest
  `2026*_recovery_*.sql` migrations, incl. `20260704000000_recovery_whatsapp.sql`).
- **Production env vars are set** on the app host (`app.skelo.team`):
  - `CRON_SECRET` — guards the once-a-minute dispatch tick.
  - `SHOPIFY_APP_URL` = `https://app.skelo.team` and
    `SHOPIFY_WEBHOOK_ADDRESS` = `https://app.skelo.team/api/webhooks/shopify`.
  - `BOLNA_WEBHOOK_SECRET` — voice provider webhook secret.
  - `KWIKENGAGE_WEBHOOK_SECRET` (+ optional `KWIKENGAGE_WEBHOOK_ALLOWED_IPS`,
    `KWIKENGAGE_API_BASE_URL`) — WhatsApp delivery webhook.
- **The dispatch tick runs every minute** (Supabase `pg_cron` or an external
  scheduler POSTing `/api/cron/campaigns/tick` with the `x-cron-secret` header).
- **At least one admin exists** (`profiles.is_admin = true`).

---

## Part A — General org onboarding (every workspace)

### A1. Create the account + workspace (client)
The client signs up at `/signup`, then at `/onboarding` names their workspace →
this creates the organisation (they become its owner). If they already have a
workspace they skip straight to the dashboard. *(To pre-create, just have them
sign up and name the workspace; nothing admin-side is required to make the org
exist.)*

### A2. Find the org in the admin console (you)
Go to **`/admin` → Organisations**, open the workspace. The detail page
(`/admin/organisations/[id]`) is your provisioning home: **Org info**, **Voice
agent**, **WhatsApp**, and a **Workspace configuration** list (Voice agents,
Lead fields, Dashboard, Call outcomes, Cart Recovery).

### A3. Connect the voice agent (you)
On the org detail page → **Voice agent** card:
- Paste the **Outbound Agent ID** and **API key** (from the voice provider's
  dashboard) and an optional **Caller ID** number → **Connect**.
- Use the provider dashboard to point the **post-call webhook** at
  `https://app.skelo.team/api/webhooks/bolna/leads?secret=<BOLNA_WEBHOOK_SECRET>`
  and enable extraction so transcripts + extracted fields flow back.

### A4. Configure routing + workspace behaviour (you, as needed)
From the **Workspace configuration** list on the org detail page:
- **Voice agents** — link the agent IDs that route inbound calls to this org
  (this is the trusted tenancy gate, not the LLM's guess).
- **Lead fields** — choose which extracted fields show on the leads table.
- **Call outcomes** — map each disposition to succeed / fail / callback / retry.
- **Dashboard** — compose the org's analytics from the catalogue (optional).

### A5. Verify (you)
- The owner's **Settings** page shows the **Voice agent** card as **Connected**.
- Place a test call (Campaigns → Test Call) and confirm it appears in
  Conversations with a transcript once complete.

The org is now live for calling. Continue to Part B only if they're doing
Shopify cart recovery.

---

## Part B — Shopify cart-recovery org (adds on top of Part A)

Prereq: Part A done for this org (a connected voice agent powers the call
channel), and the platform env vars above are set.

### B1. Client creates a Shopify app + shares credentials
Ask the client to, in their Shopify admin (**Settings → Apps → Develop apps**):
1. Create a custom app with the **`read_checkouts`** and **`read_orders`** scopes.
2. Add our OAuth callback to the app's **allowed redirect URLs**:
   `https://app.skelo.team/api/shopify/oauth/callback`.
3. Send you: the **store domain** (`something.myshopify.com`), the app's
   **API key (Client ID)**, and the **API secret key**.

### B2. Connect + authorize + register webhooks (you)
Org detail page → **Workspace configuration → Cart Recovery (Shopify)**
(`/admin/organisations/[id]/shopify`):
1. Paste **store domain + API key + API secret** → **Save credentials**.
2. Click **Authorize with Shopify** — the store approves once and the access
   token is fetched + stored automatically.
3. Click **Register webhooks** (installs `checkouts/create`, `checkouts/update`,
   `orders/create` pointed at `SHOPIFY_WEBHOOK_ADDRESS`).
4. Click **Show webhooks** to confirm all three are registered.

> If "Register webhooks" errors with *"SHOPIFY_WEBHOOK_ADDRESS is not set"*, the
> prod env var is missing — fix it (Platform prerequisites) and retry.

### B3. Connect WhatsApp (you) — optional second channel
Org detail page → **WhatsApp** card:
1. In the KwikEngage/Kwikchat dashboard: get the **API token** (Integrations →
   API), and submit a **Meta-approved template** (Marketing category; see the
   template in [docs/cart-recovery.md](cart-recovery.md) / the onboarding notes).
2. In the WhatsApp card: paste the **API token**, **sender**, the approved
   **template name**, and the **template language** (the Meta code the template was
   approved under — `en`, `en_US`, … — must match exactly or the BSP 400s) →
   **Connect**. Leave "API base URL" blank (defaults to `https://api.kwikengage.ai`).
3. In the KwikEngage dashboard, set the **delivery webhook** to
   `https://app.skelo.team/api/webhooks/kwikengage?secret=<KWIKENGAGE_WEBHOOK_SECRET>`.
4. **Send test** (on the WhatsApp card) — fires one real template send to a number
   you choose, using the saved config. If it's rejected, the exact provider error
   is shown (bad template name / wrong language / parameter-count mismatch). Fix and
   re-test until it delivers before enabling the channel for real carts.

> Until an approved template is set, the WhatsApp track is **skipped**
> (`no_template`) and voice still runs — WhatsApp is purely additive.

### B4. Tune + turn on (client, or you on their behalf)
On the org's **Cart Recovery** page (Campaigns → Templates → Cart Recovery):
- Set the **wait time** and **max attempts**, optional **calling window** (IST).
- Pick the **offer** from the **Shopify dropdown** (captures the discount % +
  code the agent/message quotes).
- Under **Channels**: enable **Voice** and/or **WhatsApp**. Voice always calls
  first; when WhatsApp is on it's sent as soon as the connected call ends (or as a
  fallback if the call never connects) — no order or gap to set.
- Hit **Start**.

### B5. Verify end-to-end (you)
1. Abandon a test cart with a phone you control (set wait to ~1 min).
2. A row appears on the **Carts** tab; on the next tick the voice call fires, and
   the WhatsApp goes out once that call ends (or after voice gives up). Watch the
   cart drawer's WhatsApp timeline (Sent → Delivered → Read) and the Call history.
3. **Complete the order** → it moves to **Converted** and both channels stop. The
   **Cart Recovered** stat counts every conversion (call-driven + organic). Strict
   **ROI attribution** ("Recovered · by us" in the cart drawer) is separate — it
   only credits us when a call actually reached the shopper before purchase.

To fire the tick immediately instead of waiting:
```bash
curl -X POST https://app.skelo.team/api/cron/campaigns/tick \
  -H "x-cron-secret: <CRON_SECRET>"
```

---

## Quick reference

| Thing | Where / value |
| --- | --- |
| Admin console | `/admin/organisations/[id]` |
| Owner status (read-only) | Workspace **Settings** page |
| Shopify webhook (auto-registered) | `https://app.skelo.team/api/webhooks/shopify` |
| Voice post-call webhook | `…/api/webhooks/bolna/leads?secret=<BOLNA_WEBHOOK_SECRET>` |
| WhatsApp delivery webhook | `…/api/webhooks/kwikengage?secret=<KWIKENGAGE_WEBHOOK_SECRET>` |
| Shopify OAuth callback | `…/api/shopify/oauth/callback` |
| Dispatch tick | `POST …/api/cron/campaigns/tick` (`x-cron-secret`), every minute |
| Required Shopify scopes | `read_checkouts`, `read_orders` |
| WhatsApp send API | `POST https://api.kwikengage.ai/send-message/v2` |

## Troubleshooting (fast hits)

- **Cart Recovery page throws "column … does not exist" / carts won't load** →
  the DB isn't migrated. Run `npx supabase db push`.
- **Abandoned carts exist in Shopify but nothing shows in Skelo** → webhooks
  aren't reaching us. Check `SHOPIFY_WEBHOOK_ADDRESS` is set in prod, then
  **Register webhooks** again and **Show webhooks** to confirm.
- **All calls fail with "country code" error** → phones stored without a code;
  the dialer prepends the default (`DEFAULT_DIAL_CODE`, +91) — confirm it's set
  for the region.
- **WhatsApp shows "skipped: no_template"** → no approved template set on the
  WhatsApp connection (or in recovery settings). Add it.
- **WhatsApp delivery ticks not updating** → confirm the KwikEngage delivery
  webhook points at our endpoint with the right `?secret=`; unrecognised payload
  shapes are logged (`[kwikengage] webhook: unrecognised payload …`) for
  calibration.
