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

## 4. Tokens vs. approval — two things people confuse

These are **completely separate**, and mixing them up causes bad planning.

### Getting a long-lived token is just an extra API call

When an org logs in, we first get a **short-lived token** (valid ~1 hour). We then make **one
more API call** that swaps it for a **long-lived token** (valid ~60 days), and a background job
refreshes it before it expires. That's the whole story.

**This has nothing to do with Meta's approval.** We can get a full long-lived token today, with
zero review, for any account we control. Approval is *not* the price of a long-lived token.

### Approval is about *who is allowed to connect*, not about tokens

- **Development mode** (the default, no review): the login + long-lived-token flow works fully —
  but **only for Instagram accounts we've personally added to our app** (us + our beta testers).
  Random members of the public are blocked at the login screen.
- **Live mode** (after approval): the login screen works for **anyone**, so real customers can
  connect themselves.

The token mechanism never changes between the two. **Only the guest list changes.**

| | Long-lived token? | Which accounts can connect? |
| --- | --- | --- |
| **Development mode** (today, no review) | ✅ Full 60-day token | Only accounts we've added (us + testers) |
| **Live mode** (after approval) | ✅ Same token | Anyone — real customers, self-serve |

---

## 5. The connection flow, step by step

This is identical in Development and Live mode — the only difference is whether the connecting
account is on our allow-list yet.

```
1. Org owner clicks "Connect Instagram" in Skelo Settings
        │
2. Popup opens on instagram.com — they log in and see:
     "Skelo wants to: read messages, manage comments, send messages"
     → they tap Allow
        │
3. Instagram redirects back to us with a temporary "code"
        │
4. [server-side] We swap the code → SHORT-lived token   (~1 hour)
        │
5. [server-side] We immediately swap short → LONG-lived token  (~60 days)
        │   ← the "extra API call". No approval involved.
        │
6. [server-side] We tell Instagram to send this account's DMs/comments to our webhook
        │
7. [server-side] We store the long token (encrypted) under that org's row
        │
8. Owner sees "✅ Connected as @theirhandle" + a "send test DM" button
        │
9. [background, forever] A refresh job renews the token before it expires
```

Steps 4–5 are the token dance — always available, no gatekeeping. The only real gate is step 2:
in Development mode, an account that isn't on our allow-list is refused there. Approval removes
that gate for everyone.

**Important:** we require the org to have an Instagram **Professional** account (Business or
Creator). Personal accounts can't be connected. Onboarding should detect this and walk the owner
through the free in-app conversion, instead of letting the login fail with a confusing error.

---

## 6. Testing: how many accounts, and what's real

While the app is in Development mode, the accounts that can connect are the ones we add by hand
under **Roles**, as **Instagram Testers**. We enter each handle; the owner accepts an invite from
their own Instagram settings.

- They must be **real Instagram Professional accounts**, added one at a time.
- The cap is **generous — dozens, easily enough for a private beta.** It is *not* a tiny number
  like 3–5.
- Testers get the **full, real product**: real long-lived token, real webhooks, real DMs, real
  comment replies. It is not a crippled sandbox.

> Verify the exact current numeric cap against Meta's live docs before planning a *large* beta —
> Meta adjusts these — but for "us + 10–20 friendly beta orgs," we're comfortably within limits.

The upshot: we can build and fully test the **entire** feature right now, no approval, using a
few of our own Professional accounts plus our beta testers.

---

## 7. The road to production (verification & review)

Getting to "any org can connect themselves" is a checklist with **two tracks that run in
parallel**, neither of which blocks engineering (we build in Development mode the whole time).

**Track A — Business Verification** (proves *Skelo the company* is real)

- Done in Meta Business settings: legal business name, address, a document or two, plus
  phone/domain verification.
- **Timeline: a few days to ~2 weeks.** Pure paperwork with a slow queue.

**Track B — App Review** (proves *our use of each permission* is legitimate)

- **Prerequisites we set up first:** a public **Privacy Policy** URL, a **Data Deletion**
  callback/instructions, app icon, category, and a clear use-case description.
- **Submit each permission** we need, with evidence:
  - `instagram_business_basic`
  - `instagram_business_manage_messages` (DMs)
  - `instagram_business_manage_comments` (comment automation)
  - `instagram_business_content_publish` (only if we auto-post / publicly reply)
- Each needs a **screencast** of the real end-to-end flow (org connects → a DM arrives → we
  reply), **step-by-step reviewer instructions**, and sometimes a **test login**.
- **Timeline: a few days to ~2 weeks per round, expect 1–2 rounds** of back-and-forth. Normal,
  not a failure.

**Then — flip to Live.** Once Business Verification is done **and** the permissions come back
with **Advanced Access granted**, one toggle removes the allow-list and real customers can
self-serve. No further per-org approval after that.

### Realistic timeline

```
Week 0        Build in Dev mode with our own tester accounts (full product)
Week 0 ──┐    Start Business Verification  ─────────────┐  (parallel)
         └──  Prep privacy policy + data deletion       │
Week 2-3      Record screencasts, submit App Review     │
Week 3-5      Handle 1-2 rounds of reviewer feedback ◄──┘
Week 4-6      Advanced Access granted → flip to Live → public onboarding
```

**~4–6 weeks of calendar time to production, almost none of it blocking the build.** The two
long poles are out of our control: **Business Verification** and a clean **screencast**. Start
Business Verification on **day one** — it's slow, needs nothing from the finished product, and is
the item most likely to silently delay launch.

---

## 8. Could we onboard real clients the "tester" way and skip approval?

Short answer: **yes for a handful, as a temporary bridge — but it is not a real launch path, and
we should not lean on it.**

Mechanically it works. Accounts we add under **Roles** (tester/developer/admin) get **Standard
Access** to the permissions and can use the full product **without App Review**. So we *could*
manually add our first few paying design-partners as Instagram Testers and serve them for real,
today, with no approval.

Where it breaks down:

- **It doesn't scale.** Every client must be added by hand *and* accept a tester invite from deep
  inside their own Instagram settings — clunky, and definitely not self-serve.
- **There's a cap.** Role-based users top out at a few dozen; past that, it simply stops.
- **Lower limits.** Standard Access generally carries tighter rate limits than the Advanced Access
  you get after review.
- **It's against the spirit of the platform.** Tester roles exist for *development*. Using them to
  run a production business is a way of dodging review, and Meta can treat that as circumvention —
  a risk to the whole app if enforced.

**How to use it:** as a **pilot / private-beta bridge** for our first design-partners while
Business Verification and App Review are in flight. It lets us earn revenue and gather the exact
screencast footage review needs. **Do not** treat it as the permanent go-to-market — get approved
and flip to Live for real launch.

---

## 9. The real challenges (what bites in production)

Roughly in order of how much they'll hurt:

1. **Rate limits are pooled at the *app* level, not per-org.** Instagram's messaging quota is
   shared across every connected account. One noisy tenant — or a viral post spawning thousands of
   comments — can degrade everyone. We need per-org throttling, a priority queue, and monitoring on
   our remaining quota. Architecturally the most important thing to get right early.
2. **The 24-hour window + policy.** We can freely message a user only within 24h of *their* last
   message. Outside it the options are narrow — there's no Instagram equivalent of WhatsApp's cold
   broadcast templates. The sender tracks last-inbound-per-user-per-org and refuses (with a clear
   reason) anything that would violate the window.
3. **Comment automation is policy-constrained.** Meta is stricter on public comments than on DMs.
   The blessed pattern is exactly our funnel: reply to a comment once, then move to DM. Design
   toward that, don't fight it.
4. **Token lifecycle at scale.** 60-day tokens across many orgs means a refresh job plus graceful
   handling of revocation (password change, app removed, account downgraded to personal). A dead
   token should surface as "reconnect needed" in that org's Settings, never a silent drop.
5. **Account-type gating at connect time.** Only Professional accounts work; many owners have
   personal accounts. Detect and guide conversion inline, or "Connect" fails mysteriously.
6. **RAG latency and correctness.** Webhook → retrieve context → LLM → reply is a live loop inside
   the 24h window and against rate limits. Needs dedup (Meta redelivers), fast retrieval, a fallback
   when the model is slow/uncertain, and a guardrail so the bot never promises beyond the org's
   knowledge base. The RAG index is **per-org** — fits our tenancy model, but means an
   ingestion/embedding pipeline per org.
7. **Webhook demux and ordering.** One app webhook receives events for *all* connected accounts. We
   resolve the org from the trusted Instagram account ID in the payload — never from anything the
   message claims — and handle duplicate / out-of-order delivery.

---

## 10. Delivery plan — three phases

We ship this in three phases, each a usable step on its own. The order is deliberate: build the
plumbing first, then a valuable rules-only product, then the AI differentiator on top once the
monitoring and safety rails already exist.

```
Phase 1 — Connector        Phase 2 — Rules automation      Phase 3 — RAG AI replier
(get connected,            (comments + DMs fire            (catalog-grounded AI,
 receive events)      ─▶    configured replies)       ─▶    rate limits, handoff, cost)
 foundation                 shippable product               the differentiator
```

Each phase also unlocks the matching Meta permission for App Review (see §7): Phase 1/2 DMs need
`instagram_business_basic` + `instagram_business_manage_messages`; Phase 2 comments add
`instagram_business_manage_comments`; public comment replies add `instagram_business_content_publish`.

### Phase 1 — Instagram account connector

**Goal:** an org can securely connect their Instagram, and we reliably receive their events.
Nothing customer-facing beyond the connect screen yet.

**What we build:**

- **The connector** (`src/lib/instagram/`) — OAuth for **both** connect paths:
  **Instagram Login** (no Facebook Page needed, the smoothest door) *and* the **Facebook-Page
  path** for accounts that need it. We detect what an org can use, prefer Instagram Login, and fall
  back to the Page path. Mirrors how our voice and WhatsApp connectors are built.
- **Per-org settings** — encrypted long-lived token, account id, handle, and which path was used.
  Service-role only (same posture as `bolna_integrations` / WhatsApp settings).
- **Token lifecycle** — short→long exchange, the 60-day refresh job, and revocation handling that
  surfaces "reconnect needed" in Settings instead of silently going dark.
- **Webhook receiver** — verifies the signature, resolves the org from the trusted account id, and
  dedups. In this phase it just acknowledges and logs events — no automation yet.
- **Connect UI** in Settings — detect Professional account (guide the free conversion if needed),
  Connect button for both paths, connected state, and a "send test DM" check.

**Done when:** a tester org connects via *either* path, we hold a valid long-lived token, and
inbound events arrive at our webhook — verified and attributed to the right org.

### Phase 2 — Comment auto-reply & DM automation

**Goal:** rules-based automation live end to end — **no AI yet**. Deterministic, predictable, and
low-risk; it's also what most ManyChat users actually run day to day.

**What we build:**

- **Rules engine** — triggers (comment keyword, comment→DM, DM keyword, first-DM welcome, story
  reply) → actions (public reply, send DM, create/tag lead). Every send passes the **24-hour
  window guard**.
- **The comment→DM funnel** — reply publicly once, then move the real answer to a DM. Meta's
  blessed pattern (see §9).
- **Lead creation** — an inbound comment or DM finds-or-creates the lead and attaches the
  conversation, alongside that lead's calls and WhatsApp history.
- **Configuration section** (UI) — create/edit rules, keywords, and canned responses; toggle rules
  on/off; the 24-hour guard. (This is the "Automation" screen in the org-side preview.)
- **Monitoring section** (UI) — the unified inbox (DMs + comments on the lead) plus a rules
  dashboard: what fired, delivery successes/failures, volume, and comment→DM conversion.
- Timed follow-ups (welcome, gentle nudges) reuse the **every-minute scheduler**.

**Done when:** an org configures a comment→DM rule and a DM keyword rule, they fire correctly
inside the 24-hour window, create leads, and the org can watch it all in monitoring.

### Phase 3 — RAG AI automated DM replier

**Goal:** the differentiator — AI answers DMs grounded in the org's own catalog, safely and
affordably.

> **First task, before building the throttle:** *confirm the real, current Graph API messaging
> rate limits* (per-app and per-user) against Meta's live docs and our own testing. The widely
> repeated "200 DMs/hour" figure was **refuted** in our research — we set caps from validated
> numbers, not folklore.

**What we build:**

- **Per-org RAG pipeline** — ingest the org's catalog + FAQs + policies, embed and index **per
  org**, retrieve at reply time. Grounded answers only, with a guardrail so the bot never promises
  beyond its knowledge base.
- **The AI replier — "suggest first, then auto."** Ships as **human-approved AI drafts** (the
  AI-draft card in the preview). An org graduates specific rules to **auto-send** once it trusts
  them. Earns confidence before going hands-off.
- **Rate limiting** — per-org **configurable** throttle, respect Meta's `429`s and rate-limit
  headers, and a priority queue (the pooled app-level quota is the real constraint). Caps seeded
  from the confirmed limits above.
- **Human-handoff config** — route a conversation to a person when **any** of these fire, each
  configurable per org:
  - **Low AI confidence** or an answer not grounded in the catalog — don't guess.
  - **The customer asks for a human** ("talk to someone", "agent", "call me").
  - **Order / payment intent** — high-value moments get a human touch.
  - **Negative sentiment / complaint** — frustration or refund anger escalates.
  - **Token/cost budget exceeded** — a per-conversation (and per-org) spend cap; once crossed, the
    AI stops and hands off rather than running up cost.
- **Monitoring section** (UI) — AI-vs-human split, a **breakdown of handoff reasons**, token/cost
  per org, deflection rate, reply latency, groundedness/failure flags, and rate-limit headroom.

**Done when:** an org's DMs get catalog-grounded AI answers under the confirmed rate limits,
drafts can graduate to auto-send, and every handoff trigger — including the cost cap — works and
is visible in monitoring.

> The interactive org-side preview and the competitive teardown live in
> [manychat-findings.html](manychat-findings.html): the "Automation" screen ≈ Phase 2 config, and
> the AI-draft conversation ≈ Phase 3's suggest-first behaviour.

---

## Bottom line

The option that *looks* cheapest — renting a tool — is actually the most expensive in lost
margin and lost control, and it fights the way our product is built. Building directly on
Instagram reuses the machinery we already have and keeps every lead in our own database.

The only genuine cost is waiting for Instagram's approval — which we'd have to do on any
honest path anyway, and which doesn't stop us from building in the meantime.
