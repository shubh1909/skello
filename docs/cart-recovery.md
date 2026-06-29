# Cart Recovery — Plan (plain-English)

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
(how many carts, how many recovered, how much revenue came back), not an
upload-and-run screen. Each future template can have its own shape; Templates is
just the shelf they sit on.

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
5. If they still haven't bought, our voice agent **calls them**, mentions the items
   they left, and offers the deal the client chose.
6. If the shopper completes their purchase at any point, the store tells us, and we
   **cancel the call** so we never bother a customer who already bought.

## What the shopper hears on the call

The agent knows, and can naturally talk about:

- The shopper's name.
- The exact items left in the cart and the cart total.
- A link to finish the purchase (sent/mentioned as set up).
- The offer the client picked — for example "10% off with code SAVE10," or "a free
  gift with your order."

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
- **The offer** to give — chosen from the client's own Shopify data, either:
  - a **discount code** (e.g. SAVE10), or
  - a **free product** from their catalogue.

## Who we call (and who we don't)

- We only call shoppers who **left a phone number** and **agreed to be contacted**.
  Email-only or no-consent shoppers are skipped (and logged), to stay compliant.
- For the first version we do **voice calls only**. Text/WhatsApp follow-up can be
  added later if wanted.
- If a shopper already bought, or asked not to be contacted, we don't call.

## How we keep it safe and reliable

- **Each client is fully separate.** We always work out which store a message
  belongs to on our side — we never take the store's word for it.
- **Secrets stay on our servers**, never exposed to any browser.
- **No double-calling.** Even if the store sends us the same notice twice, we only
  ever schedule one recovery per cart, and we cancel it the instant the order
  completes.
- **Built on what we already have.** The calling, scheduling, and retry machinery is
  the same proven system we already use for our other call features — we're plugging
  Shopify into it, not building a second system.

## What's built (all of it)

Everything below is implemented end-to-end:

1. **Connect a store** — the admin screen to enter a client's keys and mark them
   connected.
2. **Listen for abandoned carts** — receiving the store's notifications safely,
   with the genuineness check on every message.
3. **Schedule the recovery** — turning an abandoned cart into a planned call (wait
   time, consent check, no-double-call rules).
4. **Make the call** — the agent rings the shopper with the cart details and offer,
   and retries per the client's settings; it stops if they buy.
5. **Offers** — the client picks the discount/freebie, with a "load from Shopify"
   helper.
6. **Dashboard** — the live view of carts, calls, recoveries, and revenue.

Not yet done: automated tests for the call-retry decisions (the security + cart
reading are tested), and the optional switch to one shared Skelo app.

## Going live: setup checklist

**Once, on our side:**

- Set `SHOPIFY_APP_URL` to `https://app.skelo.team` (used to build the callback
  address the store approves during Authorize).
- Set `SHOPIFY_WEBHOOK_ADDRESS` to `https://app.skelo.team/api/webhooks/shopify`
  (the address Shopify sends alerts to; the "Register webhooks" button uses it).
- Apply the database changes (the migrations).

**Per client:**

1. **Connect the store** (us) — paste the store address + API key + API secret on
   the admin Cart Recovery screen, **Save**, then click **Authorize with Shopify**
   (the store approves once and we get the access pass automatically).
2. **Register webhooks** (us, one button) — tells Shopify to start sending that
   store's abandoned-cart alerts.
3. **Tune + turn on** (client) — on their Cart Recovery page, set the wait time and
   attempts, pick the offer, and switch it on.
4. **Tweak the agent script** (one-time, per client) — the voice agent's script
   must mention the shopper's name, cart, link, and offer, otherwise it has the
   info but won't say it.

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
4. On the org's **Cart Recovery** page: turn it **on**, set "wait before calling"
   to **1 minute** (so you're not waiting around), and pick an offer.
5. In the dev store, go to checkout, **enter a phone number you can answer**, tick
   the marketing/consent box, and **leave without paying**.
6. Within a minute or two a row appears on the dashboard as **Waiting**. On the
   next background tick (once a minute) the call fires — you should get it. To not
   wait, trigger the tick by hand (below).
7. Go back and **complete the purchase** → the row flips to **Recovered** and any
   pending call is canceled.

**Trigger the call immediately (skip the wait):** the calls are placed by a
once-a-minute background job. To run it on demand, send it a nudge:

```bash
curl -X POST https://app.skelo.team/api/cron/campaigns/tick \
  -H "x-cron-secret: <the CRON_SECRET value>"
```

**What to watch on the dashboard:** rows move **Waiting → Calling →
Reached/Recovered**. A **Skipped** row with a reason (`no phone` / `no consent`)
means the cart wasn't eligible — handy for confirming the consent rule works. If
checkouts come in but everything is "skipped: no consent," the store's checkout
isn't collecting a consent tick.

## Still to confirm

- Do the clients' checkouts actually **capture phone numbers and consent**? That
  decides how many abandoned carts we can legally call.
- Each client's voice agent script needs a **one-time tweak** so it naturally
  mentions the cart items and the offer.
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
