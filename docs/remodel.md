# The Lead & Voice Agent Remodel — what changed and how to test it

This is the plain-English version of what we shipped, why we shipped it,
and how to confirm everything still works — both in the app and in the
Supabase dashboard.

If you only have 30 seconds, here's the short version:

> Each phone number is now one lead, no matter how many calls happen.
> Every conversation becomes its own call record under that lead. Calls
> are routed to your workspace using the agent id (not the LLM's guess
> at the business name). Admins can lock fields they've manually
> corrected so the next call doesn't overwrite them. New fields the
> voice agent extracts show up in Admin → Organisations → <your workspace> → Lead fields, where you
> decide which become table columns.

---

## What changed and why

### 1. One lead per phone, not one per call

**Before:** Every inbound call created a brand-new lead row. If the same
person called twice, you'd see them as two different leads. Their name
might be filled in on the first row but blank on the second. Picking the
"real" one was guesswork.

**Now:** A phone number is the lead's identity. Call once, get a lead.
Call again — same number, same lead, just a new call attached to it.

### 2. Per-call snapshots live on calls, not leads

**Before:** The summary, recording, "actionable next step", customer
type — all of those lived on the lead row and got overwritten by the
next call.

**Now:** They're per-call. Each call keeps its own immutable record
("here's what happened on April 12 vs April 30"). The lead row only
holds the current rolled-up view (latest non-null wins).

### 3. Calls are routed by agent id, not business slug

**Before:** Our webhook looked at a field the AI extracted from the
conversation (`business_slug`) to decide which workspace the lead
belonged to. When the AI dropped that field — like the customer
reported — the call was rejected.

**Now:** Routing uses the agent id, which is metadata the telephony
provider sends on every call. It's deterministic; the AI can't break
it. If the agent id is missing for some reason, we fall back to the
dialled number. The `business_slug` is still captured but only as an
advisory hint for debugging.

### 4. Manual edits can be locked (audit included)

**Before:** If you corrected a lead's name in the CRM, the next call's
LLM extraction would clobber your edit.

**Now:** Click the small lock icon next to a field to mark it as
manually-set. The voice agent will record what it heard on subsequent
calls (still visible in call history) but won't touch your edit on
the lead row. The lock drawer also shows full history — who changed
what, when, and what the previous value was. Unlock at any time to
let auto-updates resume.

### 5. Dynamic fields + per-org catalog

**Before:** The leads page showed the same hard-coded columns for every
workspace.

**Now:** Every field the voice agent extracts (whether we knew about it
or not) gets auto-registered in a per-workspace catalog. In Settings →
Lead fields, you can choose which become columns on the leads table,
rename them, set their data type, and so on. New fields appear
automatically the first time the agent sends them.

### 6. Voice agent management UI

**Before:** Multiple agents per workspace was an ops-managed array
column with no UI.

**Now:** Admin → Organisations → <your workspace> → Voice agents. Add an agent by id; we verify it
against your account before linking. Label them, disable them, remove
them. One agent can only belong to one workspace (enforced in the
database).

### 7. Dynamic columns + filters + search on the leads table

**Before:** The leads page had hard-coded columns. If your voice agent
captured "budget" or "preferred-time-of-day", you had no way to expose
it as a column or filter on it.

**Now:** Every field you flip to **Visible** in Admin → Organisations → <your workspace> → Lead fields
shows up as a column on the leads page. Fields flagged **Filterable**
appear in a "+ Add filter" picker above the table. Fields flagged
**Searchable** are folded into the search box (the search box also
covers name, notes, phone, and anything in the rolled-up lead data).
Refresh the page after toggling visibility — the new columns appear.

### 8. Tagged errors for easier debugging

Every server-side error now logs and surfaces a `[SKELO:DOMAIN-CODE]`
tag — both in the server logs and in the user-facing toast. When you
see a toast like *"Could not record override audit row [SKELO:OVERRIDE-WRITE-FAIL]"*,
paste the tag into your log search to find the matching server stack.
A full table of codes is in the **Error codes** section below.

### 9. Callers page is gone — Leads is now the only list

**Before:** Two sidebar entries — **Leads** (one row per phone, with
call counts) and **Callers** (per-record list with intent / pending /
status filter chips). They overlapped enough to be confusing.

**Now:** Just **Leads**. The Callers route and its sidebar entry are
removed. The Leads page is also slimmer:

- **Removed columns:** "Total" (calls) and "Talk time" — duplicate of
  the In + Out breakdown that's still there.
- **Removed column:** "Status" — the pipeline status field still lives
  on the lead row and is editable from the detail drawer; it just no
  longer occupies a table column. (This matches the long-standing
  convention for the Status filter, which has been UI-hidden for a
  while — query param still works for deep links.)
- **Removed stat card:** "Avg calls per lead" — referenced total
  touchpoints, no longer relevant.

The catalog-driven dynamic columns (section 7) are unchanged.

### 10. Lead call history — audio + transcript + snapshot in one view

**Before:** The lead detail drawer showed the latest 8 calls in a tiny
list. To listen to a recording you opened the URL in a new tab; to
read the transcript you opened a modal **inside** the drawer (modal-
in-a-sheet). No way to see calls #9+ for a heavy-history lead.

**Now:** Every call row in the drawer is clickable. Clicking one — or
the new **Show all (N)** button on the Call history section header —
expands the drawer to a two-pane history view:

- **Left rail:** the full paginated list of calls for this lead (20
  per page, **Load more** at the bottom). Compact rows with direction
  icon, counterparty number, when, duration, and status badge.
- **Right pane:** the selected call's detail — an inline `<audio>`
  player with native browser controls, the call's summary and
  actionable next-step (if extracted), the per-call snapshot
  (`name_extracted`, `interest`, `lead_intent_extracted`,
  `customer_status`, `visit_scheduled_at`, `connect_on_whatsapp`),
  collapsible raw `lead_data` / `custom_data` JSON for debugging,
  and the full transcript rendered as a chat thread.

The transcript loads lazily when a call is selected — switching calls
doesn't refetch the rail. The selected call is reflected in the URL
as `?call=<id>` so a tester can copy/paste the link to land back on
the same call (the sheet must already be open for the link to take
effect; opening a lead row → ?call= lands you straight into history
mode).

### 11. Realtime is actually on for leads + calls + transcripts

**Before:** The client had subscription hooks (`useLeadsRealtime`,
`useCallsRealtime`) wired to the leads page and conversations page,
but the underlying tables weren't in the `supabase_realtime`
publication. The subscriptions were silently no-ops — you had to
refresh to see new calls.

**Now:** A new migration (`20260518000000_realtime_publication.sql`)
adds `public.leads`, `public.calls`, and `public.call_transcripts`
to the publication. The existing hooks now fire correctly — a new
inbound call appears on the leads list / conversations page without
a refresh. RLS still gates which rows each client sees, so the
publication doesn't relax tenancy.

### 13. Single-webhook deployments now get the full call lifecycle

**Before:** Skelo exposed two webhook endpoints —
`/api/webhooks/bolna/leads` for the post-call extracted_data fire,
and `/api/webhooks/bolna/calls` for intermediate status transitions
(ringing → answered → completed) plus the campaign-contact state
machine. The Bolna dashboard only accepts **one** webhook URL per
agent. Customers who pointed it at `/leads` got the lead/transcript
data fine, but **campaigns broke silently**: contacts stayed in
`in_flight` forever because `applyCampaignContactOutcome` (the
function that advances `succeeded` / re-arm / `failed`) only ran from
`/calls`. Live "Ringing"/"In progress" badges also never fired, and
the transcript-enrichment retry-with-backoff never kicked in.

**Now:** A shared helper at [src/lib/bolna/status-update.ts](../src/lib/bolna/status-update.ts)
owns the status-update logic. Both endpoints call it:

- `/calls` — same behaviour as before, 404 on no-match (a real config
  error there).
- `/leads` — when a payload arrives without `extracted_data` (a
  pre-extraction event), the route now runs the same status update
  instead of silently `{ ok: true, ignored: "no extracted_data" }`.
  `not_found` is returned as 200 (inbound calls land before the
  `calls` row exists; that's expected, not an error).

**Practical consequence:** you can point Bolna at *only*
`/api/webhooks/bolna/leads` and the full lifecycle still works —
status updates, campaign progression, transcript enrichment. The
`/calls` endpoint stays available for anyone who wants two webhook
slots, but it's no longer required.

### 12. Voice agents + Lead fields moved out of Settings into Admin

**Before:** Both the **Voice agents** manager and the **Lead fields**
catalog manager lived under the tenant-facing Settings page. Any
workspace user could in principle add a new agent or rename an
extracted field. The Settings sidebar listed them alongside Account
and Billing.

**Now:** They've moved to the Skelo admin console at
**Admin → Organisations → <your workspace> → Voice agents** and
**Admin → Organisations → <your workspace> → Lead fields**. Both
pages are gated by `requireAdmin()` against `profiles.is_admin`, so
tenant users can no longer reach them. The Settings page for tenants
now shows a short note: *"Voice agents and lead fields are configured
by your Skelo onboarding team. Reach out to support if you need a
change."*

**Why:** These are configuration surfaces that affect how every
inbound/outbound call routes and which extracted fields surface in
the UI. A misconfigured agent id or a wrong field type set by a
non-technical workspace user could silently break the pipeline for
the entire org. Centralising them under admin means support can
audit and gate changes.

The underlying tables (`voice_agents`, `lead_field_definitions`)
and their RPCs are unchanged — only the route that renders the UI
moved. The component files themselves
([voice-agents-manager.tsx](../src/components/app/voice-agents-manager.tsx),
[lead-fields-catalog-manager.tsx](../src/components/app/lead-fields-catalog-manager.tsx))
also stayed put.

---

## Where to find things in the app

| What | Where |
|---|---|
| Connect / disconnect the voice provider | Settings (top "Voice agent" card) — visible to all workspace users |
| Add / rename / remove voice agents | **Admin → Organisations → <your workspace> → Voice agents** — admin-only |
| Decide which extracted fields show up as columns | **Admin → Organisations → <your workspace> → Lead fields** — admin-only |
| Lock a lead field so the AI can't overwrite it | The small 🔒 icon next to a field on the lead detail drawer — any workspace user |
| See edit history for a field | Click that same lock icon |

---

## Testing it manually (no SQL needed)

These walkthroughs cover the main user-facing changes. Do them in this
order; later ones build on earlier ones.

### Test A — Voice agents page works

> Requires a Skelo admin account (`profiles.is_admin = true`). Tenant
> users no longer see voice agents or lead fields in Settings — that
> screen just shows a "configured by your Skelo onboarding team" note.

1. Sign in as an admin, then go to **Admin → Organisations**. Pick
   the workspace you're testing. You should see "Voice agents" and
   "Lead fields" in that workspace's nav.
2. Click **Voice agents**.
3. If the workspace had voice agents already, they should appear in
   the table — including any agent ids that were previously hidden in
   the multi-agent array.
4. Try **Add agent** with a random fake id like `not-a-real-agent`.
   It should fail with a clear error about the voice provider not
   recognising the id. This proves verification works.
5. Add a real agent id from your provider dashboard. It should link
   immediately and appear in the table with a green "Active" badge.
6. Click the pencil icon to rename it. Save. Refresh — the new label
   sticks.
7. Click **Disable** on a non-default agent. The badge turns to a
   muted "Disabled" pill. Re-enable.
8. Click the trash icon on a non-default agent — it asks for
   confirmation, then removes the row. (The default agent's trash icon
   is disabled with a helpful tooltip.)

### Test B — Same number, two calls = one lead

This is the headline fix. You need access to your voice provider to
trigger inbound calls.

1. Look at the leads list. Note how many rows you have.
2. From a phone, call your voice agent's inbound number. Have a normal
   conversation; give your name as "Alice".
3. Wait ~30 seconds for the webhook to land. Refresh the leads page.
   You should see a new lead row with name "Alice" and your phone
   number. Click into it — call history should show one call.
4. Call back from the **same number**. This time, don't give a name;
   keep it short.
5. Refresh the leads page again. The lead count should **not** have
   gone up by one (it's still the same Alice). Click into Alice's
   detail. Call history now shows **two** calls. The lead row's name
   stays "Alice" because the second call didn't change it.

### Test C — Locking a field

1. Open any lead with an auto-filled name. Notice the small unlock
   icon next to "Name" — that means the field is unlocked (voice
   agent can update it).
2. Hover the icon. Click it. A drawer opens on the right showing
   "Field history". Initially: empty.
3. In the drawer, click **Lock current value**. The icon next to
   "Name" turns amber and shows a filled lock. The drawer now shows
   one history row: "Locked" with the current value.
4. Close the drawer.
5. Trigger another call from the same number (or for testing, edit
   the name in another tab, save, then come back). Either way:
   the next call where the LLM extracts a different name won't
   change this lead's name. The call record will still show what
   the LLM heard — but the lead row stays at your locked value.
6. Click the lock icon again to reopen the drawer. Click **Unlock**.
   The icon goes back to muted. The history now has two rows: the
   "Locked" event and the "Unlocked" event with timestamps.
7. Edit the name to something new and save. Open the lock drawer
   again — a third event appears with old → new values.

### Test D — Field catalog discovery

1. Go to **Admin → Organisations → <your workspace> → Lead fields**.
2. If you haven't received any calls since the migration, the table
   will be empty with a helpful message.
3. Trigger an inbound call. Refresh the catalog page. Every field
   the voice agent extracted should appear as a row — name,
   interest, lead_intent, anything custom your agent emits.
4. Each row has:
   - A label input (rename "interest" → "Customer Interest")
   - A data type dropdown (Text / Number / Yes-No / Date / Picklist)
   - An eye icon to flip Visible on or off
   - Checkboxes for Filterable / Sortable / Searchable
5. Toggle a field to Visible. Click **Save**.
6. Toggle the type if it's been mis-inferred (e.g. shows "Unknown",
   change to "Text"). Save.

### Test F — Dynamic columns, filters, search on the leads page

You'll need at least one field flipped to **Visible** + **Filterable**
in Admin → Organisations → <your workspace> → Lead fields first (Test D step 5–6).

1. Go to **/leads**. The columns you flipped to Visible should appear
   between "Status" and "Pending" — labelled with whatever you set in
   the catalog (or the raw key if you skipped the label).
2. Each visible row should show the value pulled from the lead's
   rolled-up dynamic fields (latest non-null wins). If a field is
   missing on a particular lead, you'll see "—" — that's normal, not
   an error.
3. **Search box** (top left). Type a name, a phone fragment, or any
   word the voice agent might have captured. Hit Enter. The table
   re-filters; the count badge above the infinite scroll updates.
   Click the × to clear.
4. **+ Add filter** (top right). Pick any field flagged Filterable
   from the dropdown. A chip appears below the search bar with three
   parts:
   - **Operator** dropdown (contains / is / is not / < / > / …)
     varies by data type.
   - **Value** input — text, number, date, or yes/no dropdown
     depending on the field's type.
   - **×** to remove the chip.
5. Type a value into the chip. Within ~300ms the table refetches with
   that filter applied. Add a second chip to AND another filter. The
   "Total leads" count above the infinite scroll reflects the filtered
   set.
6. Clear all filters. The full list returns.

> If the dynamic columns don't appear after toggling visibility,
> hard-refresh the leads page (Cmd+Shift+R / Ctrl+Shift+R). The server
> component caches the catalog read at request time.

### Test G — Lead call history (audio + transcript + snapshot)

You need at least one lead with one completed call that has a
recording URL on file (any inbound call that landed normally will do).

1. Open `/leads`. Click any lead row with a call count > 0. The
   detail drawer opens on the right (same as before).
2. Scroll to the **Call history** section. You should see the last
   eight calls, each with direction icon, number, duration, status.
   If the lead has more than eight calls, a **Show all (N)** button
   appears in that section's header.
3. Click any call row (not just the icon — the whole row is
   clickable now). The drawer widens and splits into two panes:
   - **Left rail** lists every call for the lead, with the one you
     clicked highlighted.
   - **Right pane** shows the call's detail.
4. Verify the right pane shows, in order:
   - Direction + status badges, counterparty number, started/ended
     timestamps.
   - An inline audio player with native controls — press play and
     confirm audio comes out. (If the recording URL is from a CDN
     that blocks `localhost` origins, that's a CORS issue on the
     provider side, not a Skelo bug — open the URL directly in a
     new tab to confirm it plays elsewhere.)
   - "Summary" block if the LLM produced one.
   - "Actionable next step" block (amber) if it produced one.
   - "Captured this call" key/value list — name, interest, intent
     badge, customer type, scheduled visit, WhatsApp preference.
   - Two collapsible "Raw lead_data / Raw custom_data" disclosures
     if the call had extracted blobs.
   - Transcript at the bottom, rendered as a chat thread (Caller
     bubbles right-aligned, Agent bubbles left-aligned).
5. Click another call in the left rail. The right pane should
   update; the rail's loaded entries should **not** refetch (no
   loading flicker on the left).
6. If the lead has more than 20 calls total, scroll the left rail
   to the bottom and click **Load more**. The next 20 append.
7. Look at the address bar — it should now read `…?call=<uuid>`.
   Copy that URL.
8. Click the **←** back arrow in the drawer header. You should
   return to the regular detail view, and the `?call=` param is
   stripped.
9. Re-open the same lead row. Paste the copied URL into the address
   bar and hit Enter. The sheet should land directly in history mode
   with the right call pre-selected.
10. Close the sheet (click outside / Esc). The `?call=` param should
    disappear from the URL so re-opening any other lead doesn't
    accidentally land in history mode.

### Test H — Realtime: new calls appear without a refresh

Requires the new migration `20260518000000_realtime_publication.sql`
to be applied.

1. Open `/leads` in one browser tab. Note the row count at the top.
2. From a second device/tab, trigger an inbound call to one of your
   voice agents (or run a campaign step). Don't touch the leads tab.
3. Within ~5 seconds of the post-call webhook landing, the leads tab
   should refresh **on its own** — a new row for a new number, or
   the existing row's last-contact time changing.
4. (Optional) Open `/conversations`. Trigger another call. The new
   call row should appear there too without a manual refresh.

If nothing updates after ~30 seconds, jump to **S9** in the SQL
section to confirm the publication actually has the tables.

### Test I — Campaign state machine advances with only /leads configured

The Bolna dashboard accepts only one webhook URL per agent. This test
confirms that pointing it at `/api/webhooks/bolna/leads` still
advances campaign contacts out of `in_flight` (the bug we just
fixed). You need a draft or running campaign with at least one
contact.

1. Confirm Bolna's webhook URL is set to
   `https://<your-host>/api/webhooks/bolna/leads?secret=<the secret>`
   — **not** `/api/webhooks/bolna/calls`. The whole point of the
   test is to prove one URL is enough.
2. Start (or resume) a campaign so a contact dispatches. Note the
   `campaign_contacts.id` of the contact about to be dialled —
   from the campaign detail page or via:
   ```sql
   select id, status, attempt, phone
     from public.campaign_contacts
    where campaign_id = '<your campaign id>'
      and status = 'in_flight';
   ```
3. Let the dial complete (answer + hang up, or let it ring out — any
   terminal outcome works).
4. Within 5–10 seconds of the post-call event landing, check:
   ```sql
   select status, attempt, lead_id
     from public.campaign_contacts
    where id = '<contact id>';
   ```
   The status should have moved out of `in_flight`:
   - Answered & ended cleanly → `succeeded` (and `lead_id` populated).
   - `no_answer` / `busy` / `failed` & `attempt < max_attempts` →
     back to `pending` with `attempt` incremented (re-armed).
   - Terminal failure & cap hit → `failed`.
5. (Server log check, optional.) Tail the dev server log during
   step 3. You should see entries like:
   - `[bolna webhook] skipping pre-extraction event` —
     **this is gone**. Instead, you'll see status-update activity.
   - For the final fire, `[inbound] recording call` or the
     outbound merge line, depending on direction.
   - No `[status-update] campaign outcome failed` entries.

If the contact is still `in_flight` after a minute, jump to the
symptom matrix entry "Campaign contact stuck in `in_flight`".

### Test E — Webhook routing

The customer-reported bug was about the AI sending `null` for
`business_slug`. To prove this is fixed without bothering the customer:

1. Trigger an inbound call normally. The lead should appear as
   expected — same as Test B.
2. (Optional — requires server-log access.) Watch the logs while
   the call is processed. You should see something like
   `[inbound] recording call { organisationId: ..., leadCreated: true }`
   and **no** rejection error about a missing business slug.

The structural fact is: routing now never looks at `business_slug`
for tenancy decisions. If the AI drops it, the call still routes
correctly via the agent id.

---

## Testing it in Supabase (SQL)

Open the Supabase SQL editor for your project and run these. They're
safe — all read-only `SELECT`s except where called out.

### S1 — Confirm the migrations applied

```sql
-- The six 0517 files plus the 0518 realtime migration should be listed.
select version, name
  from supabase_migrations.schema_migrations
 where version like '20260517%' or version like '20260518%'
 order by version;
```

You should see six 0517 rows ending in `_voice_agents_registry`,
`_lead_call_remodel`, `_dynamic_lead_fields`, `_cleanup`,
`_post_cleanup_fixes`, `_lead_activity_dynamic_filters` — plus one
0518 row ending in `_realtime_publication`.

> Migration `20260517000005_lead_activity_dynamic_filters.sql` is the
> one that powers the new filter/sort/search on the leads table. If
> you applied 0000–0004 but not 0005, the leads page may error with a
> "function lead_call_activity(...) does not exist" complaint —
> apply 0005 and retry.

### S2 — Voice agents registry is populated

```sql
-- Every voice agent your workspaces use should be here.
select agent_id, organisation_id, label, enabled, verified_at
  from public.voice_agents
 order by organisation_id, created_at;

-- The resolver returns the org for a given agent id:
select * from public.resolve_org_by_agent('<paste-an-agent-id>');
```

### S3 — No duplicate leads per phone, per workspace

```sql
-- This should return ZERO rows. If it returns any, two leads in the
-- same workspace share a phone — would mean the Phase 2 dedupe missed
-- something.
select organisation_id, phone_normalized, count(*) as dup_count
  from public.leads
 where phone_normalized is not null
 group by 1, 2
having count(*) > 1;
```

### S4 — Calls correctly attach to one lead per phone

```sql
-- Pick a lead with multiple calls. All calls should share its lead_id.
with l as (
  select id, organisation_id, phone
    from public.leads
   where phone is not null
   limit 1
)
select c.id, c.bolna_call_id, c.direction, c.started_at,
       c.name_extracted, c.interest, c.lead_intent_extracted
  from public.calls c
  join l on l.id = c.lead_id
 order by c.started_at;
```

You should see every call for that phone, each with its own per-call
snapshot fields populated.

### S5 — The override table is recording your edits

After you've done **Test C** (locking a field) above:

```sql
-- Should show your set + unlock events.
select field_path, action, value, previous_value, edited_at
  from public.lead_field_overrides
 where lead_id = '<paste-the-lead-id-you-tested>'
 order by edited_at desc;

-- "Currently locked" lookup — should match what the UI shows:
select * from public.lead_locked_fields('<paste-the-lead-id-you-tested>');
```

### S6 — The field catalog is discovering keys

```sql
-- One row per unique key the voice agent has sent for this workspace.
select source_column, category, key_path,
       data_type, visible_in_table, sample_value, last_seen_at
  from public.lead_field_definitions
 where organisation_id = '<paste-your-org-uuid>'
 order by visible_in_table desc, last_seen_at desc;
```

If this is empty for a workspace that's received calls, the
auto-discovery isn't firing — check the inbound webhook logs.

### S7 — JSONB fields on leads and calls have content

```sql
-- Pick a recent lead and inspect its JSONB:
select id, name, current_intent, lead_data, custom_data
  from public.leads
 where lead_data <> '{}'::jsonb
 order by updated_at desc
 limit 5;

-- Same for the most recent call:
select id, bolna_call_id, name_extracted, interest, lead_data, custom_data
  from public.calls
 where lead_data <> '{}'::jsonb
 order by started_at desc
 limit 5;
```

The lead's `lead_data` should be a rolled-up "current view" — the
latest non-null values. The call's `lead_data` is the snapshot from
that one conversation.

### S8 — Routing mismatch warnings (if any)

These show up only in your application server logs (not Supabase),
filed under `[inbound webhook] routing_mismatch_warn`. They mean the
AI's `business_slug` guess disagreed with the org we routed to via
agent id. The call still went through correctly — the warning helps
you spot misconfigured agent prompts.

### S9 — Realtime publication membership

If **Test H** (realtime) didn't fire, confirm the tables are in the
publication:

```sql
select schemaname, tablename
  from pg_publication_tables
 where pubname = 'supabase_realtime'
   and schemaname = 'public'
 order by tablename;
```

You should see at least: `call_transcripts`, `calls`, `campaigns`,
`campaign_contacts`, `leads`. If any of `calls`, `leads`,
`call_transcripts` is missing, the
`20260518000000_realtime_publication.sql` migration didn't apply —
push it with `npx supabase db push` and re-run Test H.

---

## What didn't change (so you can stop worrying)

- The reminders flow. Untouched.
- The conversations / calls page. Now picks up realtime updates from
  the new publication (Test H), but the layout and columns are
  identical.
- Outbound dial from the lead detail. Same button, same behaviour.
- Campaign dispatch. Routes through the same outbound path.
- Your existing API keys and from-numbers. Stayed in
  `bolna_integrations`; the admin Voice agents page is additive
  on top of that.
- The `status` field on `leads`. Still there, still editable from the
  lead edit form; only the table **column** was dropped.

## What's still in flight (next session)

- A single "Edit history" tab at the lead level. Right now history is
  per-field via the lock drawer; a "show me everything ever changed
  on this lead" view is on the wishlist.
- Per-org indexes on hot dynamic-field sort keys. Sort works fine via
  on-the-fly jsonb extraction today, but if any org passes ~50k leads
  you'll want a few expression indexes. Not urgent.

## Error codes — what each tag means and where to look

Every server-side failure logs with a `[SKELO:DOMAIN-CODE]` tag and
surfaces the same tag in the toast you see in the UI. To investigate:

1. Note the tag from the toast (e.g. `[SKELO:LEAD-MERGE-FAIL]`).
2. Search your server logs for that exact string.
3. The log line above the tag has full context: organisation id, lead
   id, agent id, the underlying cause.

| Code | Where it fires | Likely cause |
|---|---|---|
| `[SKELO:WEBHOOK-INGEST]` | inbound/outbound webhook route | Voice provider webhook payload couldn't be persisted. Check the `cause` field — usually a downstream DB error. |
| `[SKELO:ROUTING-RESOLVE]` | webhook routing layer | The webhook arrived but no workspace claims the `agent_id` and the dialled number didn't resolve uniquely either. Verify the agent is registered under Admin → Organisations → <your workspace> → Voice agents. |
| `[SKELO:LEAD-MERGE-FAIL]` | lead-merge pipeline | One of the per-key writes onto the lead row failed. The call still recorded; only the rolled-up lead view is partial. Check the `cause` for the offending field path. |
| `[SKELO:LEAD-LOOKUP-FAIL]` | find-or-create lead | Could not insert/match a lead by `(org, phone_normalized)`. Usually a uniqueness race that didn't resolve — re-trigger the call. |
| `[SKELO:LEAD-WRITE-FAIL]` | server actions writing leads | `updateLead`, `createLead`, etc. failed. Check for type mismatches in the patch payload. |
| `[SKELO:LEAD-READ-FAIL]` | `lead_call_activity` RPC | The RPC errored — most often a filter/sort that referenced a non-existent column when migration 0005 wasn't applied. Run `select * from public.lead_call_activity('<org-id>'::uuid, '<slug>', false, 10, 0);` directly. |
| `[SKELO:OVERRIDE-WRITE-FAIL]` | clicking lock / unlock | The audit row insert OR the JSONB write to the lead failed. Confirm `apply_lead_field_jsonb` RPC exists. |
| `[SKELO:OVERRIDE-READ-FAIL]` | opening the lock drawer | History query failed — check RLS / connection. |
| `[SKELO:FIELD-DEF-WRITE-FAIL]` | catalog auto-discovery or admin save | One of the `register_lead_field` calls in the webhook merge failed, OR an admin save in Admin → Organisations → <your workspace> → Lead fields errored. Best-effort — won't break the call, but the field may not appear in the catalog. |
| `[SKELO:FIELD-DEF-READ-FAIL]` | loading the catalog page | RLS or connection issue. |
| `[SKELO:VOICE-AGENT-VERIFY]` | "Verify & link" in Add agent dialog | The provider's API rejected the agent id OR network failed. Confirm the id in the provider dashboard. |
| `[SKELO:VOICE-AGENT-WRITE]` | linking / labelling / removing an agent | DB write failed. If it's a unique violation, the agent is already claimed by another workspace. |
| `[SKELO:VOICE-AGENT-READ]` | populating the campaigns agent picker | `voice_agents` or `bolna_integrations` couldn't be read. |
| `[SKELO:ANALYTICS]` | dashboard / pulse pages | Analytics queries failed; charts gracefully degrade to empty. Check for the cause in the warning log. |
| `[SKELO:EXPORT]` | `/api/leads/export` | CSV generation failed — usually the lead query or the latest-call snapshot lookup. |
| `[SKELO:CAMPAIGN]` | campaign create / start / stop | Campaign action errored. Often the workspace's `bolna_integrations` config is missing or the chosen agent isn't linked. |

### "If you see X in the UI, look here" — symptom matrix

| Symptom | First thing to check |
|---|---|
| Leads page shows "function does not exist" or a 500 | Apply migration `20260517000005_lead_activity_dynamic_filters.sql`. |
| Add agent dialog says "Voice provider rejected this agent id" | Re-copy the agent id from the provider dashboard; whitespace at start/end is the most common gotcha. |
| Add agent dialog says "already linked to another workspace" | The id is correct but claimed by a different tenant. Contact support — this is the unique-key safety net working as intended. |
| Inbound call doesn't appear as a lead | Check server log for `[SKELO:ROUTING-RESOLVE]`. Confirm the agent is registered (Admin → Organisations → <your workspace> → Voice agents) and `enabled`. |
| Lead's name keeps getting overwritten on each call | Click the lock icon next to the name and choose **Lock current value**. |
| Lock icon won't toggle | Look for `[SKELO:OVERRIDE-WRITE-FAIL]` in logs. The `apply_lead_field_jsonb` RPC is the usual suspect — confirm migration 0002 fully applied. |
| Admin → Organisations → <your workspace> → Lead fields is empty | Either no calls have landed yet, or the auto-discovery RPC is silently failing — grep logs for `[SKELO:FIELD-DEF-WRITE-FAIL]`. |
| Toggled "Visible" but column doesn't appear on /leads | Hard-refresh (Cmd/Ctrl + Shift + R). The page caches the catalog read. |
| Filter chip doesn't narrow results | The field's data type may be wrong (e.g. picking "<" on a Text field). Open Admin → Organisations → <your workspace> → Lead fields and set the correct type. |
| Campaigns page won't let you save | Usually "Selected agent is not linked to this workspace" — link the agent in Admin → Organisations → <your workspace> → Voice agents first. |
| CSV export downloads but a column is blank | Some columns (Summary, Recording) come from the latest call's snapshot. Leads with zero calls have nothing to surface. |
| Inline audio player shows but won't play | The recording URL works in a new tab → it's a CORS issue with the provider CDN against your dev origin. Configure the provider to allow your origin, or test on the staging host where origins line up. The URL doesn't work in a new tab either → the provider hasn't finished uploading; webhook fired before recording was stored. Wait 30 s and retry. |
| Lead detail drawer won't enter history mode | The Call history section's **Show all** button only appears when the lead has at least one call. Confirm `select count(*) from calls where lead_id = '<id>'` is > 0. |
| `?call=<uuid>` deep link doesn't pre-select the call | The sheet has to be opened by clicking the row first. Open the lead manually, paste the URL — it should pick up. (Auto-opening the sheet from URL state is on the wishlist.) |
| Leads page doesn't update on a new inbound call | Realtime publication is missing the table. Run **S9** SQL check — if `calls` or `leads` is missing, push migration `20260518000000_realtime_publication.sql`. |
| Looking for the Callers page | It's gone — merged into Leads. Sidebar entry was removed. Existing `/callers` bookmarks 404. Use `/leads` instead. |
| Campaign contact stuck in `in_flight` | The status-update path didn't fire. (a) Confirm the dialled call actually reached a terminal status (`completed` / `no_answer` / `busy` / `failed` / `canceled`). (b) Confirm Bolna's webhook URL is reachable — `/api/webhooks/bolna/leads` should be returning 200s in dev server logs. (c) Confirm the `calls` row exists and has `campaign_contact_id` set (`select campaign_contact_id from calls where bolna_call_id = '<id>'`). (d) If all three are good, look for `[status-update] campaign outcome failed` or `[SKELO:WEBHOOK-INGEST]` in server logs. |
| Live "Ringing" / "In progress" badges never appear | Make sure Bolna is actually firing mid-call status events to the webhook URL (some providers only send the final post-call event by default). Server log should show several `POST /api/webhooks/bolna/leads` lines per call — one per status transition. |

---

## Rolling back (in case of trouble)

The migrations are largely additive — the only destructive piece is
the Phase 6 cleanup migration (`20260517000003_cleanup.sql`), which
dropped legacy columns from `leads` and `bolna_integrations`. If
something goes wrong:

1. **Don't panic.** The new columns and the calls table still have
   all the data. Per-call snapshots were moved, not lost.
2. **Application-only issues** (component crashes, type errors) can
   be fixed by patching the offending file to read from the new
   source — usually `lead_data` JSONB or the latest call.
3. **Data-shape regressions** (something's missing from a row) — open
   the lead in Supabase, inspect `lead_data` and the most recent
   `calls` row for that lead. The value is almost certainly there.
4. **Worst case, restore from snapshot.** Supabase's automated
   backups are daily; the dropped columns are recoverable from any
   backup taken before the cleanup migration ran.
