# Instagram DM & Comment Automation — Build vs. Buy, Wiring, and Mechanics

A plain-language guide to how we'd add Instagram DM and comment automation to Skelo:
whether to build it ourselves or rent someone else's tool, how it plugs into what we
already have, and how it works day to day.

---

## The short version

**Build our own thin integration directly on Instagram's official system. Don't rent a
third-party tool, and never use unofficial "hack" libraries.**

We already built something almost identical: our voice-agent feature. An Instagram message
or comment is the same kind of problem as an incoming phone call — someone reaches out, we
figure out which business it's for, we find or create their record, and we reply. We'd be
reusing most of the plumbing we already have.

---

## 1. Build vs. Buy

There are really three choices, not two.

| Option | What it means | Verdict |
| --- | --- | --- |
| **A. Rent a tool** (ManyChat, Chatfuel, etc.) | We pay another company; they hold the Instagram connection and the conversations | Don't do this |
| **B. Build on Instagram's official system** | Instagram sends us messages; we reply through their official channel; everything stays in our database | **Recommended** |
| **C. Unofficial "hacks"** (bots that pretend to be the app) | Reverse-engineered shortcuts | Never — gets accounts banned, legal risk |

### Why not rent a tool (Option A)

- **It costs money forever.** These tools charge a monthly fee *per connected account*. In a
  product like ours with many separate businesses, that fee stacks up fast. We'd either eat
  the cost (hurts our margins) or pass it on (now we're just reselling someone else's tool).
- **We lose control of our own customers' data.** Skelo's whole value is that the lead, the
  conversation, and the follow-up all live in *our* system, neatly separated per business.
  If a rented tool holds the Instagram connection, the conversations live in *their* system
  first. We'd be constantly syncing our own data back out of someone else's product and
  fighting their limits and outages.
- **It's actually more work in the long run.** Quick to demo, but every real requirement
  (link a DM to an existing lead, trigger a voice callback from a comment, respect our
  security rules) turns into a fight against a tool that wasn't built for us.

### Why build it ourselves (Option B)

- **It's free at the connection level.** Instagram doesn't charge for sending and receiving
  messages through their official system. Our only real costs are engineering time and a
  one-time approval process (more on that below).
- **We're not starting from scratch.** Here's how Instagram maps onto what we already have:

  | We already have (voice agent) | Instagram version | Reused? |
  | --- | --- | --- |
  | Per-business voice settings | Per-business Instagram settings | Same pattern |
  | "Incoming call" webhook | "Incoming message" webhook | Same pattern |
  | Figure out which business a call is for | Figure out which business a message is for | Same pattern |
  | Turn a call into a lead | Turn a message into a lead | Same pattern |
  | Place an outbound call | Send an outbound message | Same pattern |
  | Scheduled callbacks & campaigns | Scheduled DM sequences | Same pattern |

  The genuinely new work is small: letting a business connect their Instagram account,
  getting Instagram's official approval, and handling one Instagram-specific rule (below).

- **We keep total control.** Every message and lead sits in our database, separated per
  business, exactly like calls do today. A comment on a post can instantly become a hot lead
  and even kick off a voice-agent callback — cross-channel magic a rented tool simply can't do.

### The one real cost of building

To send and receive messages on behalf of businesses we don't own, our app needs **Instagram's
official approval** (a review by Meta, Instagram's parent company). This means submitting a
short demo video and a privacy policy, and usually a couple of back-and-forth rounds.

**Plan for 2–4 weeks of waiting** for approval — but this runs *in parallel* with building,
so it doesn't block us. And it's unavoidable on *any* legitimate path; a rented tool just paid
this cost once for themselves, which is part of what their monthly fee rents you.

**Rough estimate:** about 2–3 weeks of backend work for a solid first version, plus the
parallel approval wait. Renting a tool might demo in 3 days but leaves us with a weaker
product and a permanent bill.

### A useful comparison from our own product

We *already* rent a provider for WhatsApp — and that was the right call there, because
WhatsApp **forces** you to go through an approved middleman; there's no direct door.

**Instagram is the opposite.** It gives us direct access once we're approved — no middleman
required. So Instagram is actually the *cleaner* channel to own outright. The fact that we
were forced to rent for WhatsApp doesn't apply here.

---

## 2. How it connects to what we already have

We follow the voice-agent blueprint almost step for step.

- **The Instagram connector** — a small, self-contained piece of code that talks to
  Instagram's official system (sends replies, reads messages, keeps the connection alive).
  This mirrors how our voice and WhatsApp connectors are built.

- **Per-business settings** — a new place to store each business's Instagram connection,
  locked down so only trusted server code can read it. Same pattern as our existing voice
  and WhatsApp settings. Each business owner connects their own account from Settings.

- **The "incoming message" listener** — a single web address that Instagram notifies whenever
  someone DMs or comments. It does three things, just like our call listener:
  1. **Checks the message is genuinely from Instagram** (a cryptographic signature check, so
     nobody can fake messages).
  2. **Figures out which business it's for** using trusted account information — never trusting
     anything a message merely *claims* about itself.
  3. **Ignores duplicates.** Instagram sometimes sends the same notification twice; we make
     sure that never creates two leads or two replies.

- **Turning messages into leads** — an incoming DM or comment finds or creates the person's
  lead record (matched on their Instagram identity instead of a phone number) and files the
  message under it. Same logic our calls use.

- **Automated replies and sequences** — we reuse the existing **scheduler that already runs
  every minute** to send follow-up messages, welcome DMs, and nudges. It already handles four
  kinds of automated outreach in parallel; Instagram becomes a fifth. No new scheduling
  system needed.

- **One Instagram-specific rule to respect:** Instagram only lets us freely message someone
  within **24 hours** of their last message to the business. Outside that window there are
  stricter rules. We build this limit into the sender so we never send a message that would
  be blocked, and we show a clear reason when we can't.

Everything else — our database, our security layers, our server tools — stays exactly as it is.

---

## 3. How it works, day to day

Two simple flows, both mirroring how our phone calls already work.

### Getting set up (once per business)

1. A business owner clicks **"Connect Instagram"** in Settings and logs into their Instagram
   account to grant us permission.
2. We securely save that connection and tell Instagram to start notifying us about that
   account's messages and comments.

### Someone reaches out (incoming)

3. A customer DMs the business or comments on a post. Instagram notifies our listener.
4. We verify it's really from Instagram, figure out which business it's for, and sort it into
   "DM" or "comment."
5. We find or create the customer's lead record and save the message. A comment can even be
   judged as high-intent and trigger a voice-agent callback.

### We respond (outgoing)

6. **Instant reply:** rules or AI decide the response, and we reply — publicly on a comment,
   and/or as a private DM (within Instagram's 24-hour rule). This is the classic
   "reply to a comment, then slide into DMs" funnel that turns a public commenter into a
   private conversation.
7. **Follow-up sequences:** the every-minute scheduler sends timed follow-ups (a welcome
   message, a gentle nudge if there's no reply, qualifying questions) — the same way our
   campaigns dial through a list of contacts.
8. Every reply from the customer loops back to step 3, and the whole conversation stays
   attached to one lead — visible right alongside that lead's calls and WhatsApp history.

---

## Bottom line

The option that *looks* cheapest — renting a tool — is actually the most expensive in lost
margin and lost control, and it fights the way our product is built. Building directly on
Instagram reuses the machinery we already have and keeps every lead in our own database.

The only genuine cost is waiting for Instagram's approval — which we'd have to do on any
honest path anyway, and which doesn't stop us from building in the meantime.
