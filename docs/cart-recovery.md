# Cart Recovery — Plan (plain-English)

## What we're building

When a shopper on a client's Shopify store adds items, starts to buy, but leaves
without paying, our voice agent calls them a little later. The agent reminds them
what they left behind, answers questions, and offers a small deal (a discount or a
freebie) to bring them back to finish the purchase.

We're building this so it works the same way for every client we onboard — not a
one-off for a single store.

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

Every client creates a small private app inside their own Shopify store and hands us
three things:

- Their **store address** (the `something.myshopify.com` name).
- An **access key** that lets us read their carts and orders.
- A **secret** that lets us confirm messages truly come from their store and not an
  impostor.

We enter these once on an internal admin screen. Each client's keys are stored
separately and securely, so one client can never see or affect another.

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

## Build order (each step is usable on its own)

1. **Connect a store** — the admin screen to enter a client's keys and mark them
   connected.
2. **Listen for abandoned carts** — start receiving the store's notifications safely.
3. **Schedule the recovery** — turn an abandoned cart into a planned call (with the
   wait time, consent check, and no-double-call rules).
4. **Make the call** — the agent rings the shopper with the cart details and offer,
   and retries per the client's settings.
5. **Offers** — let the client pick the discount or freebie from their store data.
6. **Polish** — reporting, consent/Do-Not-Call handling, and tests.

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
