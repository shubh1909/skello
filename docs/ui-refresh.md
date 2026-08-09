# UI Refresh — brand palette + UX restructure

Living record of the Skelo UI refresh. Update the status table as stages land.

## Why

The old theme was a blue/bone palette (`#355872` navy, `#7AAACE` steel, `#9CD5FF` sky,
`#F7F8F0` bone). The new-UI prototype established a different, deliberately restrained
language: **deep teal ink on ivory, a permanently dark teal sidebar, and every hue except
success/danger desaturated into the teal family.**

That restraint is the point. The old palette was more saturated *and* the app leaked 306
raw Tailwind palette colours across 30 files — colours no rebrand could reach, because
there was no semantic token to reach for instead.

Alongside the rebrand, the refresh clears the structural debt that stopped the app looking
considered: three duplicate `Field` implementations, three unrelated tab idioms, a
2,328-line lead sheet with two independent edit modes, no mobile navigation, and a dead
search box in the topbar.

## Status

| Stage | What | Status |
|---|---|---|
| 1 | Tokens, Inter, badge shape, both sidebars | ✅ Done |
| 2 | Semantic status colours; `ErrorCard` + `Alert` callouts | ✅ Done |
| 3 | Shared primitives: tabs, table chrome, `SectionLabel`, card rhythm | ✅ Done |
| 4 | The three detail sheets | ✅ Done |
| 5 | Sidebar structure, icon rail, mobile nav, ⌘K search, theme toggle | ✅ Done |
| 6 | Avatar tones, chart tokens, helper dedupe, stale docs | ✅ Done |
| 7 | Cart recovery + COD reach parity with the lead sheet; sidebar flattened | ✅ Done |
| 8 | Campaigns: list, detail and performance | ✅ Done |

Decisions taken up front: **dark palette + a real theme toggle**, **sidebar always dark**,
**Inter over Geist**.

---

## The palette

Single source of truth: [`src/app/globals.css`](../src/app/globals.css). Values below are
what the reference specified; the compiled CSS lands on the same hexes.

| Role | Hex | Token |
|---|---|---|
| Page background | `#FCFDFB` | `--background` |
| Card | `#FFFFFF` | `--card` |
| Muted surface | `#F3F6F4` | `--muted` |
| Foreground | `#0F2D32` | `--foreground` |
| Muted foreground | `#4E6E74` | `--muted-foreground` |
| Primary / focus ring | `#1A525A` | `--primary`, `--ring` |
| Border | `#E3EAEB` | `--border` |
| Sidebar | `#00272C` | `--sidebar` |
| Sidebar active | `#1A525A` | `--sidebar-accent` |
| Sidebar dim text | `#a7c0c4` | `--sidebar-muted-foreground` |
| Chart series (categorical) | `--chart-1..8` | see Stage 6 |
| Avatar tones | `--avatar-1..8` | all at OKLCH L 0.53 |
| Success | `#1E6F52` / `#E7F0EB` | `--success` / `--success-muted` |
| Danger | `#A8443B` / `#F5EAE8` | `--destructive` / `--destructive-muted` |
| Warning | `#826d40` (ochre) | `--warning` / `--warning-muted` |
| Info | `#436f7a` (teal) | `--info` / `--info-muted` |
| Highlight (lime) | `#FBFFE6` / `#DFECB8` | `--highlight` / `--highlight-border` |

### Things that will look like bugs but aren't

**`warning` and `info` are heavily desaturated, and that's deliberate.** Only success and
danger carry real chroma; warning is a muted ochre and info a muted teal, both well under
success (0.090) and danger (0.134). Restraint here is the single biggest driver of the
premium feel — and the reason a literal `bg-amber-100` can never express it. If a warning
badge looks "too quiet", that is the design.

**One considered deviation from the reference.** Its `--amber` (`#5E7E84`) and `--blue`
(`#4E6E74`) are *both* teal-greys, and `--blue` is byte-identical to `--ink-soft` — so
warning, info and neutral all collapse into one grey. The reference gets away with that
because its pills lean on a leading dot plus the label to differentiate. Our status chips
need **five** distinguishable tones (good / active / waiting / soft / attention), so warning
took a muted ochre and info a clearer teal. Everything else follows the reference exactly.

**The lime `--highlight` is a fill, never a focus ring.** `--highlight-border` at
`oklch(0.92)` against white is far below the contrast WCAG 2.4.11 wants from a focus
indicator, so `--ring` is the teal primary instead. `--highlight` is reserved for selection
and emphasis surfaces.

**`--sidebar-*` is identical in `:root` and `.dark`, on purpose.** It is deliberately absent
from the `.dark` block so the values are *inherited*, not restated — the sidebar does not
follow the theme, and two copies would drift.

⚠️ **Everything rendered inside `<aside>` must use `sidebar-*` classes.** A stray
`text-muted-foreground` there is `oklch(0.516)` teal on `oklch(0.249)` teal — invisible in
light mode, where nobody thinks to check. This caught both sidebars during Stage 1.

**`--sidebar-muted-foreground` is brighter than the reference's `#8AA6AB`.** That value is
tuned for a 13px dim label; our nav items are 14px body text carrying the primary
wayfinding, and at the original lightness they read as disabled.

**The radius did not change.** The reference's `10px` is already our `--radius`
(`0.625rem`). What changed is `Badge`: `rounded-4xl` (26px pill) → `rounded-sm` (squared
chip). Pills read as consumer; squared chips read as instrument.

**Shadows are tinted with the nav hue, not black** (`rgb(0 39 44 / …)`). Neutral black
shadows read as "default framework".

---

## Stage 1 — Tokens and brand ✅

Files: [`globals.css`](../src/app/globals.css), [`layout.tsx`](../src/app/layout.tsx),
[`badge.tsx`](../src/components/ui/badge.tsx),
[`sidebar-nav.tsx`](../src/components/app/sidebar-nav.tsx),
[`admin-sidebar.tsx`](../src/components/admin/admin-sidebar.tsx),
[`logo.tsx`](../src/components/brand/logo.tsx), [`format.ts`](../src/lib/format.ts)

- Full palette swap, keeping every existing token name so ~788 tokenised class usages
  across 112 files re-skinned for free.
- New semantic tier: `--success`, `--warning`, `--info`, `--destructive-muted`, each with a
  `-muted` fill; plus the `--highlight` trio. None of these existed before.
- New `--sidebar-muted-foreground` and `--sidebar-hover` — shadcn's stock sidebar token set
  has no muted foreground, which is why the sidebars had reached for global tokens.
- Eight `--avatar-1..8` muted tones + `avatarTone(seed)` in `src/lib/format.ts`.
  Deterministic, so a person keeps their colour across table, sheet and pulse list.
  (Stage 6 applied these and retuned their lightness — see below.)
- `--chart-1..5` rewired to the muted palette. They were defined before and referenced by
  **zero** components. (Stage 6 applied these too, and extended them to eight.)
- Both sidebars rewritten onto `sidebar-*` tokens (~22 call sites).
- `Logo` gained `tone="sidebar"` — `bg-primary` *is* the sidebar hue now, so the mark
  inverts to a white tile with a teal letter.
- Inter replaces Geist Sans under `--font-inter`. The old `--font-sans` name shadowed
  Tailwind's own token, forcing a self-referential `--font-sans: var(--font-sans)` that
  only worked because next/font redefined it at the `<html>` scope. Geist Mono stays for
  phones and IDs.
- Dropped `richColors` from `<Toaster>` — it made sonner apply its own red/green palette,
  overriding the CSS vars `sonner.tsx` wires up. Toasts were the one surface ignoring the
  brand entirely.

### Scrollbars

Split treatment, matching the reference. The sidebar `<nav>` uses `no-scrollbar` (a default
OS scrollbar on dark teal looks broken). Content scrollbars are **kept** but quietened —
10px, transparent track, translucent `color-mix` thumb, plus Firefox `scrollbar-width:
thin`. On a leads table running to hundreds of infinite-scrolled rows the thumb is the only
signal of depth; hiding it costs more than it saves.

### `next-themes` removed

Replaced by [`src/lib/theme.ts`](../src/lib/theme.ts) +
[`src/components/theme-provider.tsx`](../src/components/theme-provider.tsx).

`next-themes@0.4.6` (the latest release) renders its pre-paint `<script>` from inside a
**client** component, with no prop to disable it. React 19 warns — correctly, since a
script rendered on the client never executes. Not fixable by configuration.

Three things about the replacement that are load-bearing:

1. **The bootstrap script lives in the root layout's `<head>` — a Server Component.** That
   is the only place it was ever useful: the browser gets it in the HTML stream and runs it
   before first paint. `THEME_BOOTSTRAP_SCRIPT` must stay in lockstep with the provider's
   apply effect; if they disagree about how a stored value maps to a class, you get a flash
   on every load.
2. **The apply effect skips its first commit deliberately.** During hydration React renders
   with the *server* snapshot (`DEFAULT_THEME`), so without the guard the effect would
   strip `.dark` off `<html>` that the bootstrap just set — a white flash on every load for
   dark-mode users. Both compute from identical inputs, so on first commit there is nothing
   to do by construction.
3. **State comes from `useSyncExternalStore`, not an effect.** `localStorage` and
   `matchMedia` are external stores; mirroring them into state from an effect triggers a
   cascading re-render on every mount (and eslint's `set-state-in-effect` rightly flags
   it). Same-tab changes propagate via a custom `skelo:themechange` event, because
   `storage` only fires in *other* tabs.

Default stays **light**, not OS-derived — the previous `defaultTheme="light"` behaviour.
Flipping it to `"system"` would silently move every dark-OS user to dark on deploy.
`useTheme()` is ready for the Stage 5 toggle.

### Deliberately not done in Stage 1

The sidebar active-state bug — `pathname.startsWith(href)` makes `/campaigns` and its child
highlight simultaneously — is a *behaviour* change and does not belong in a tokens-only
commit. Queued for Stage 5.

---

## Stage 2 — Semantic status colours ✅

**306 raw palette occurrences across 30 files → 0.** All of it was status signalling; the
string `bg-{amber|emerald|blue|red}-100 text-…-800 dark:bg-…-500/15 dark:text-…-300` was
copy-pasted across at least nine files, and none of it followed a rebrand.

Every status→meta map now stores a `Badge` variant instead of a class string, so call sites
never write `dark:` — the token carries both themes. `BadgeVariant` is exported from
`badge.tsx` so a typo is a type error rather than an unstyled badge at runtime.

Heaviest: `recovery-badges.tsx` (100 hits), `campaign-performance.tsx` (32),
`campaigns-table.tsx` (22), `leads-activity-table.tsx` (20), `lead-detail-sheet.tsx` (20),
`campaigns/[id]/page.tsx` (16).

### What landed beyond the colour swap

- **`src/lib/campaigns/status.ts`** — `CAMPAIGN_STATUS_LABEL` / `CAMPAIGN_STATUS_VARIANT`.
  Both maps previously existed **verbatim in two files**, so the campaigns list and a
  campaign's own detail page could disagree about the same campaign.
- **`ErrorCard`** (`src/components/app/error-card.tsx`) — adopted at all **23 sites** across
  16 files. Built on `Alert`, not `Card`, for the `role="alert"`: these render *instead of*
  the content the user asked for, and a styled box tells assistive tech nothing happened.
- **`Alert` gained `success` / `warning` / `info` variants.** Per shadcn's composition rules
  ("callouts use Alert") there is no bespoke `Callout` component — the four different
  hand-written amber card recipes became `<Alert variant="warning">`.
- **Chart series read from meaning, not hue.** `call-outcomes.tsx` was the tell: it mixed
  `bg-destructive` and `bg-sky-300` *in the same map*, which is what a palette with no
  "in motion" vocabulary looks like.

### Convention worth knowing

```
bg-{tone}-muted     the card/panel-level surface wash
bg-{tone}/15        a chip or circle sitting ON that wash
hover:bg-{tone}/15  hover on a -muted base
```

A blanket find-and-replace flattens all three to `-muted`, which makes nested elements
vanish into their own container and silently kills hover feedback. That happened during this
stage and was caught in review — worth re-checking if you ever re-run a bulk colour pass.

Left alone: `text-[#25D366]` in `brand/whatsapp-icon.tsx` — real WhatsApp brand green.

### Pre-existing lint errors surfaced (not introduced, not fixed here)

`npx eslint` reports 14 errors in files this stage touched. All are on lines the colour work
never went near, and all reproduce at the same line numbers on `HEAD`:
`react-hooks/purity` (`Date.now()` during render — `voice-agent-banner.tsx:39`,
`calls-csv-importer.tsx`, `lead-fields-catalog-manager.tsx`), `react-hooks/set-state-in-effect`
and `preserve-manual-memoization` (`lead-detail-sheet.tsx`), and
`react/no-unescaped-entities` (`voice-agents-manager.tsx`). Fixing them inside a colour
commit would blur "moved" with "changed".

> **Follow-up:** Stage 4.4 cleared both `preserve-manual-memoization` errors in
> `lead-detail-sheet.tsx`. The `set-state-in-effect` ones remain — see the note at the end
> of Stage 4 for why they were left rather than swept into an extraction commit.

---

## Stage 3 — Shared primitives ✅

Where Stage 2 unified how things are *coloured*, this unified how they're *built*.

### `NavTabs` — `src/components/app/nav-tabs.tsx`

Three unrelated tab idioms became one. **Deliberately not shadcn's `Tabs`:** three of
the four switched a *route* (`?status=done`, `?include=all`, `?tab=calls`), so the content
is server-rendered per URL and there are no panels for a stateful primitive to own. A
`<nav>` of `<Link>`s is the honest markup, and it keeps middle-click and "open in new tab"
working — which a button-based tab list silently breaks.

This also fixed a real bug: `/leads` and `/reminders` had **byte-identical** `FilterTab`
copies except the reminders one rendered a raw `<a>`, so every filter click there was a
full page reload.

**`Tabs` is still the right answer where the switch is genuinely client state** — the
cart-recovery workspace's segmented control now uses it, which brings the roving arrow-key
focus and aria wiring the hand-rolled buttons never had. Its panels are deliberately *not*
`keepMounted`: each tab owns paged rows and a realtime subscription, so mounting all three
would triple the work on first paint.

### `DataTableHead` / `DataTableCard` — `src/components/app/data-table.tsx`

**Eleven `<thead>`s across six different recipes → zero hand-rolled heads.** The fill was
sometimes on the `<thead>` and sometimes on the `<tr>`; sizes ran `text-xs` / `text-[11px]`;
tracking ran `wider` / `widest`; `bg-muted/30` was present or missing. Two of those axes
were real distinctions and survive as props (`filled`, `sticky`); the rest was drift.

It deliberately does **not** abstract columns, sorting or rows. Two tables use `table-fixed`
+ `<colgroup>` with drag-resizable widths persisted to localStorage, and one is
catalog-driven — a generic `DataTable` would either fight them or flatten them to the lowest
common denominator. Only the chrome was ever duplicated, so only the chrome is shared.

shadcn's `table` primitive was added, evaluated and **removed**: adopting it means rewriting
every `<th>`/`<td>` in files Stage 4 restructures anyway, and adopting it in just the simple
tables leaves a half-migration — worse than either end state.

### `SectionLabel` — 34 sites across 22 files

One role, previously three sizes and two trackings. Settled on the reference's `.sect`
(10px, semibold, `tracking-widest`), and `DataTableHead` uses the same values — a column
header is the same semantic role, so it shouldn't be a fourth size.

`lead-detail-sheet.tsx` is **deliberately skipped**: Stage 4 replaces its six repeated
label divs with `SectionLabel`/`DetailPanel` wholesale, and converting now would be churn on
a file about to be split.

### `Empty` — 8 states

Previously three icon sizes (`size-14`/`12`/`10`), two gaps and two paddings for the same
moment. The dashed border also reads as "nothing here" rather than "a card that happens to
be blank". `locked-card`'s denied state keeps its destructive tint — it's a refusal, not an
absence.

### Card edge and H1 scale

`Card` moved from `ring-1 ring-foreground/10` to `border`. The ring ignored `--border`
entirely, so it never followed the rebrand — and cards sat flush against sidebars, topbars
and table heads that all use `border-border`, putting two edge treatments together on every
page.

**Floating overlays keep their ring** (dialog, popover, dropdown, select): they lift off the
page on a shadow rather than sitting flush, and swapping them to a border would shift their
inner content by 1px for no visible gain. `tooltip` had *both* and lost the ring.

H1s: `/leads` and `/campaigns` were the only two pages at `text-3xl md:text-4xl` against
~16 at `text-2xl md:text-3xl`. The smaller pair wins — it also matches the reference's 22px
page title. The marketing page's `<h2>`s are intentionally larger and untouched.

---

## Stage 4 — Detail sheets 🟡

Three sheets that shared no vocabulary: `Field` existed three times, the section-title
class six times, the muted-box recipe eight times.

### They are not merged, and the reason is decisive

They are three **entities** — a CRM person (`leads`, editable), an abandoned checkout
(`shopify_recovery_attempts`, read-only) and one phone call (`calls`, read-only) — and they
**stack**: the call sheet opens *on top of* the cart sheet from its call-history list. One
merged component would have to open on top of itself.

What they share is a **chassis, not a body**. The genuine duplication is elsewhere: the
*call* view exists three times (inside the lead sheet, `recovery-call-detail.tsx`, and
`call-transcript-dialog.tsx`), all rendering the same `calls` row in the same order in three
visual languages. That merge is Stage 4.4, still outstanding.

### `src/components/app/detail-sheet/`

`DetailSheetShell` · `DetailSheetPanel` · `DetailSheetBody` · `DescriptionList` ·
`DetailPanel` · `NoteCard` · `PanelGrid` · `DetailTimeline`

**The scroll model.** `SheetContent` is already `flex flex-col h-full`; the old sheets
defeated that by putting `overflow-y-auto` on the popup *itself*, which is exactly why
nothing could be pinned — the header scrolled away with the content. Now the popup is
`overflow-hidden`, the header `shrink-0`, and each panel `min-h-0 flex-1 overflow-y-auto`.
`min-h-0` is load-bearing: without it a flex child won't shrink below its content height and
the scrollbar migrates back to the popup. Putting the scroller inside each panel is also
what gives every tab its own scroll position.

> ⚠️ **Never put a display utility (`flex`, `grid`, `block`) on a panel.** Base UI hides an
> inactive `keepMounted` panel with the `hidden` *attribute*, which works through
> `[hidden] { display: none }` in the UA stylesheet. Any author `display` class beats that
> and the hidden panel renders on top of the active one. `DetailSheetPanel` nests a flex
> child instead.

**Base UI `Tabs` `defaultValue` is `0` — an index.** With string tab values, leaving both
`value` and `defaultValue` unset selects nothing and the sheet opens blank. The shell goes
controlled only when a caller actually drives it, and otherwise passes `tabs[0].value`.

**One width scale** as a `cva`. An override must match the primitive's
`data-[side=right]:sm:max-w-sm` selector shape exactly or the default wins — tailwind-merge
cannot collapse two differently-prefixed classes. The lead sheet is `lg` *always*; it used
to jump 560→1280px when history mode engaged, which is what forced two entire layouts to
exist.

### The empty-value policy is a layout fix, not a style preference

The old `Field` returned `null` **while being a direct child of `grid grid-cols-2`**, so
column assignment changed per render and the grid reflowed. Now: an item never returns
`null` (empty renders `—`); omission is a *list-level* decision applied to the array before
layout via `omitEmpty`; and `isEmptyValue()` treats `null`/`""`/whitespace/`[]`/`{}` as
empty but **`0` and `false` as present** — "WhatsApp opt-in: No" is an answer, not an
absence.

**`truncate` is banned in description lists.** It was silent data loss: a long extracted
answer rendered as a short one with no indication.

### Five tooltips is not a tooltip problem

The cart sheet had a grid of five timestamps where *every one* carried an `(i)` tooltip,
because "Checkout started" / "Received by us" / "Marked recovered" are indistinguishable as
bare labels. That is the layout admitting the labels can't do their job. `DetailTimeline`
replaces it, where order and elapsed time *are* the explanation:

```
Abandoned at checkout   14:02
Webhook received        +4s
WhatsApp sent           +2h
Order matched           +1d 3h
```

Deltas are computed between two **stored** timestamps, never against `Date.now()`, so it
renders identically on server and client. `hint` survives only for the genuinely
non-obvious (how a conversion was matched).

### Lead sheet

Tabs are **Summary | Calls · N | Activity**. `historyMode` is gone, folded into `tab`.

The URL contract is preserved byte-for-byte: `setCallInUrl` still uses raw
`window.history.replaceState` and **never `router.replace`** — a soft nav re-runs the leads
server component and hands `useInfiniteList` fresh `initialItems`, unmounting the sheet
mid-click. The active tab deliberately does **not** go in the URL.

`SheetFooter` was removed. It existed only to host Delete, burning 60px of every viewport to
make the most destructive action the most prominent thing on screen. Delete moved to the
chrome `⋯` menu, keeping its destructive styling.

**Blocker cleared:** `CALL_COLUMNS` in `shopify-recovery.ts` never selected `actionable`,
`transcript_status` or `language`, so the recovery call sheet *could not* render "Actionable
next step" and fell back to generic transcript-empty copy. Named columns added to the
already org-scoped query.

### Horizontal scroll: `grid-cols-[auto_1fr]` is a trap

`1fr` means `minmax(auto, 1fr)`, and `auto` floors at **min-content** — so one long
unbroken value (an email, a URL, an ID) pushes the whole sheet wider than the viewport.
Three grids moved to `minmax(0,1fr)` with `wrap-break-word` and `min-w-0` on the `dd`.

### 4.4 — Helpers out of the component, and the bug that was hiding in them

`src/lib/leads/` now holds four modules, all pure and all unit-tested:
`captured-fields.ts` · `effective-data.ts` · `lead-form.ts` · `captured-form.ts`.
The sheet drops from 2,308 to 1,866 lines, and 39 new tests cover logic that previously
could not be exercised without rendering the whole sheet.

#### The paging bug

The Summary tab shows captured fields, backfilling anything missing on the lead row from
its call snapshots — a real need, because a legacy lead or a failed per-key merge can leave
the row empty while every call carries the value.

It backfilled from **all currently loaded calls**. The Calls tab pages 20 at a time and
`loadMoreCalls` *appends to the same array*. So:

1. Open a lead — Summary shows 6 captured fields.
2. Switch to Calls, scroll to load older ones.
3. Back to Summary — **9 fields.** Nothing about the lead changed.

And it did not stop at display. `startEdit` prefills the form from the backfilled view, and
`onSave` diffs against the **lead row** — so a value that only existed on an older call
counted as a change and got written. **Scrolling the Calls tab before clicking Edit changed
what the save wrote to the database.** Same click, different write.

`buildEffective*Data` now takes its calls as an argument precisely so the caller must
choose, and the sheet passes `calls.slice(0, CALLS_PAGE_SIZE)`. Derived rather than held in
its own state: `calls` is only ever *set to page one* or *appended to*, so a slice is page
one by construction and there is no second variable to drift. Calls arrive newest-first, so
page one is also the most recent.

`effective-data.test.ts` pins both directions — that passing a second page **does** change
the result (the failure mode, so it can't silently return), and that slicing is stable.

#### Three copies of one skip-list

`CALL_LEAD_DATA_SURFACED`, `LEAD_DATA_SURFACED` and the transcript dialog's `PROMOTED_KEYS`
were three hand-written literals of the same idea. They genuinely differ — the lead summary
also renders City and Pincode as columns, the transcript dialog also promotes `product` —
but a difference that real deserves to be **one base plus two explicit deltas**, which is
what `captured-fields.ts` ships and what a test asserts.

Not merged: `humaniseFieldKey` in `src/lib/bolna/extract.ts`, for the reason given in
Stage 6 — it builds stored text, not a label.

### 4.6 — One edit mode

The Summary panel had **two** independent edit states, each with its own Edit, Save and
Cancel. They didn't know about each other: both could be open at once with two Save buttons
on screen doing different things, and moving from one to the other discarded the first
silently.

There was never a server reason for the split. `updateLead` takes the row fields,
`lead_data_patch` and `custom_data_patch` in a single call — so what used to be two requests
is now one atomic write that cannot half-fail. The key spaces can't collide either:
`pickEditableCatalog` excludes every `lead_data` key the details form owns, which is now a
test rather than a comment.

- One `LeadDraft { details, captured }`, seeded and saved together.
- **Edit moved to the pinned sheet header**, beside Call / WhatsApp / Remind, so it is
  reachable from any tab. Pressing it switches to Summary rather than appearing to do
  nothing, and it hides itself while editing.
- **One Save/Cancel**, in a bar that is `sticky bottom-0` inside the Summary scroller. It
  exists only while editing — a permanent `SheetFooter` is exactly what Stage 4.5 removed.

### What the two stages did to the lint baseline

`lead-detail-sheet.tsx` went from **7 eslint errors to 5**: both
`preserve-manual-memoization` bailouts are gone, because a manual `useMemo` wrapped around a
function imported from `lib/` is something the React Compiler cannot see through, so it
skipped optimising the region instead. The extracted functions are pure and bounded by one
page of calls, so they are now plain calls and the compiler handles the memoization.

The five that remain are all `react-hooks/set-state-in-effect`, unchanged from `HEAD`. They
are the sheet's data-loading and open/close reset effects. Earlier notes in this document
said Stage 4 would deal with them — **it did not**, and that was the right call: fixing them
means restructuring how the sheet loads and resets, which is a different change from
extracting helpers, and it would put the `?call=` / tab invariant at risk for no user-visible
gain.

---

## Stage 5 — Shell: sidebar, topbar, mobile ✅

Two of these were not polish. Below `md` the app had **no navigation of any kind**, and
`setTheme` was called from **nowhere** — the entire dark palette built in Stage 1 was
unreachable by deliberate user action.

### `src/lib/nav.ts` — one nav model

Four surfaces now need the nav (sidebar, drawer, breadcrumb, ⌘K), and a nav duplicated four
ways drifts within a release. `NAV_SECTIONS` is data; components only decide how to draw it.
`ADMIN_NAV_SECTIONS` lives beside it but is deliberately separate — the palette and
breadcrumb default to the customer constant, so admin routes cannot surface for a non-admin.

**The active-state bug is fixed by `activeNavHref`: longest match wins.** The old test was
`pathname === href || pathname.startsWith(href)`, which lit `/campaigns` **and**
`/campaigns/templates/cart-recovery` at the same time — the sidebar claimed you were in two
places at once. It also had no `/` boundary, so a future `/leads-archive` would have
highlighted `/leads`; the `/dashboard` special case existed only to paper over that
greediness, and is gone with it.

Two rules, because they are genuinely different questions:

| Helper | Answers | Used by |
|---|---|---|
| `isNavActive` | is this the single deepest match? | expanded nav links |
| `isNavBranchActive` | is this item *or a child* the match? | the collapsed icon rail |

The rail hides children, so a rail using `isNavActive` would highlight **nothing** on a
cart-recovery page. Covered by `src/lib/nav.test.ts`.

### Collapse is now an icon rail, not a disappearance

The old `collapsed` animated the grid to `1fr` — "collapse" deleted every piece of
wayfinding in the app, and the only route back was the toggle you had just pressed. It is
now a 4rem rail: icons with `side="right"` tooltips at a 150ms delay (the stock 600ms feels
broken on a rail), the org monogram with name and slug in its tooltip, and section labels
replaced by a hairline rule — a 10px uppercase label does not fit in 64px, and dropping the
grouping outright would run four sections into one list.

The leads count can't sit beside a centred icon, so it becomes a dot. It still says "there
is something here". Sub-items are dropped from the rail rather than squeezed into it — at
64px they would be a second column of near-identical icons with no visible parent; the
branch highlight carries the context instead.

`AppShellProvider` also moved from `useEffect` + `setState` to `useSyncExternalStore`,
matching the theme store. localStorage is an external store; mirroring it into state from an
effect is a cascading render on every mount, and it was a live eslint
`set-state-in-effect` error.

### Mobile drawer — `mobile-nav.tsx`

The `<aside>` is `hidden md:flex` with nothing behind it, so every route on a phone was
reachable only by typing the URL. The drawer reuses `SidebarNavBody` rather than restating
the nav, and always renders expanded.

**`onNavigate` closing the drawer is the whole contract:** Next's client router keeps the
drawer mounted across a route change, so without it the new page renders behind an open
panel.

The admin console got the matching *layout* fix — its grid was a fixed `260px 1fr` while its
sidebar is `hidden md:flex`, leaving a dead 260px gutter and a squeezed main column on every
phone. It still has **no drawer**: it is an internal, desktop-only console, and that is a
deliberate scope call rather than an oversight.

### ⌘K palette — `command-palette.tsx`

The topbar search was an `<Input>` with **no handler, no state and no results**. It looked
like the app's primary search and did nothing. It is now the palette trigger, and the
sidebar tip advertises `⌘K` instead of a `N` shortcut.

**cmdk's own filtering is off (`shouldFilter={false}`), on purpose.** Lead hits come from
the server, which matches on fields — notes, `lead_data` — that never appear in the rendered
row; re-filtering them client-side would silently drop real results. Nav items are filtered
here instead, over label + href + the `keywords` on the nav model.

**Results are tagged with the query that produced them.** An out-of-date response is
discarded by a `hits.query === trimmed` test at render, rather than by clearing state on
every keystroke — which is also why the debounce effect never calls `setState` synchronously
and stays clear of `set-state-in-effect`.

**Selecting a lead navigates to `/leads?include=all&q=…`, not to an open sheet.** The leads
table opens its sheet from client state, not from the URL, so there is no `?lead=<id>` to
link to; `?q=` is the honest deep link, and `include=all` stops a zero-call lead landing on
an empty table.

`Ctrl+K` is only claimed when the user isn't typing — it is "delete to end of line" inside a
text field on macOS.

**Two registry fixes.** The `command` install rewrote `ui/button.tsx`, dropping our
`nativeButton` auto-detection and the `data-slot` single-source-of-truth comment — reverted.
And the registry's `CommandDialog` renders `DialogHeader` as a **sibling** of
`DialogContent`, which puts the accessible name outside the dialog it names; moved inside.

### Theme toggle and breadcrumbs

The toggle is a `DropdownMenuRadioGroup` in the user menu (Light / Dark / System), guarded
by the same `isTheme()` the provider uses when reading localStorage. It is also reachable
from the palette.

Breadcrumbs render **only at two or more crumbs**. Every top-level page states its own name
in an `<h1>` directly below, so a lone "Leads" crumb is the same word twice; the trail earns
its space exactly where the nav is two deep. It is derived from the nav model, not from URL
segments — splitting `/campaigns/templates/cart-recovery` on `/` yields a "Templates" crumb
pointing at a route that does not exist.

### Deliberately not done

Prev/next lead navigation from inside the detail sheet. It is feasible
(`leads-activity-table.tsx` holds `items`), but wiring pagination into the sheet re-couples
the two components that the `replaceState` approach exists to keep apart.

---

## Stage 6 — Polish ✅

Mostly finishing things earlier stages started: two token families that existed and were
used by nothing, and helpers that had quietly forked.

### Avatar tones — from zero call sites to five

Stage 1 added `--avatar-1..8` and `avatarTone()`. Nothing called it. Meanwhile four
surfaces each hand-rolled `bg-muted text-muted-foreground` initials, so every row in a leads
table had the same grey disc — a decoration costing 32px that told you nothing.

`EntityAvatar` now owns it. Two things about the shape:

- **`avatarTone()` returns the surface *and* its foreground** (`bg-avatar-3 text-white`),
  because the two aren't independent choices. A caller pairing a tone with
  `text-muted-foreground` would land near 1.5:1.
- **All eight tones moved to a single L of 0.53**, from the original 0.57–0.615 spread.
  Measured against white initials, the old values ran **3.66:1 to 4.38:1** — seven of the
  eight under AA for 11px text, and unevenly so, which is the worse half: tone 3 was a
  visible step fainter than tone 6 for no reason a reader could perceive. One L puts the
  whole set at 5.2–5.4:1. This changes Stage 1's values, made at the point they were first
  actually used.

`EntityAvatar` is `aria-hidden`: the initials are always redundant with a name rendered
beside them, and a screen reader announcing "J D" before "Jane Doe" is noise. Not built on
`ui/avatar` — there are no photo URLs anywhere in this product, so the image/fallback
machinery would be a fallback that never falls back.

**The sidebar's org monogram deliberately keeps `bg-sidebar-accent`.** It is a workspace on
a chrome surface, not a person, and a hashed tone there would be the one thing in the
sidebar not using `sidebar-*`.

### Chart tokens — also zero call sites until now

`--chart-1..5` were defined in Stage 1 and referenced by no component. There are now
**eight**, and `src/lib/charts.ts` is the only place the class names are written.

The donut is why. It drew up to 8 slices as one ink (`fill-foreground`) at eight descending
opacity steps — the smallest wedges landed at 0.18, effectively invisible, next to a wedge
two places up that looked much the same. Identity now comes from hue; **opacity encodes
hover only**.

**The split between the two palettes is the actual rule:**

| | Palette | Why |
|---|---|---|
| Categorical (by agent, product, city) | `--chart-1..8` | the hue is arbitrary and only needs to be *distinct* |
| Status (call outcomes, hot/warm/cold) | `--success` / `--warning` / `--destructive` / `--info` | the colour **is** the meaning |

`call-outcomes.tsx` keeps its semantic tokens for exactly that reason. The line and bar
charts moved `bg-primary`/`fill-foreground` → `chart-1`: identical in light mode, but in
dark mode `--foreground` is near-white ink meant for text, and a series drawn in it read as
a highlight.

### Helper dedupe

**`formatDuration` existed seven times** — and not as seven copies of one thing. It was two
formats with disagreements inside each group: `45s` vs `0m 45s`, `3m` vs `3m 0s`, `0:00` vs
`—` vs `0s` for missing, and **none of them handled an hour**, so a 92-minute call rendered
`92m 14s`.

Both formats survive in `src/lib/format/duration.ts`, because both are right somewhere:
`formatDurationCompact` (`3m 20s`) reads as prose in a detail panel; `formatDurationClock`
(`3:20`) is fixed-width so a table column aligns. `empty` stays a per-call-site option — a
stat card reading "Avg call length **—**" is worse than `0:00`, because there the zero is
the answer.

**The `humanise` family existed nine times** under four names, in two behaviours: six split
on `_` only, three also handled camelCase and `-`. For snake_case input they agree exactly,
so the camel-aware one is a strict improvement and is what `src/lib/format/keys.ts` ships.
The split-only copies rendered `leadIntent` as "LeadIntent" wherever a provider sent
camelCase — **which spelling you saw depended on which panel you opened**.

Deliberately **not** merged:

- `humaniseFieldKey` in `src/lib/bolna/extract.ts` builds *stored* summary text, not a
  label on screen. Changing it changes data going forward.
- `formatDateTime` in `lib/format.ts` (medium, with year) vs the copy in
  `conversations-table.tsx` (short, no year) were never the same function. The short one
  moved to `lib/format.ts` as `formatDateTimeShort`; the two stay separate, because a table
  column needs the narrow one to hold its width.

`lib/calls/labels.ts` and `lib/csv-custom-fields.ts` re-export `humaniseFieldKey` so every
existing import path keeps working.

Both new modules have tests (`duration.test.ts`, `keys.test.ts`) pinning the specific
disagreements above.

### Docs

`docs/sitemap.md` documented `leads-table.tsx`, `leads-filter-bar.tsx` and
`campaign-call-log-sheet.tsx` — **three files that no longer exist**. Fixed, along with the
`/leads` route description, the lead sheet, the shell, the topbar, and the realtime hook
table. Eleven components added that had never been listed.

One thing CLAUDE.md flags as stale turned out **not** to be: the dispatch throughput numbers
in `sitemap.md` (`BATCH_LIMIT = 250`, `PER_CAMPAIGN_LIMIT = 100`, `CONCURRENCY = 25`) match
`src/lib/campaigns/dispatch.ts` exactly. Left as they are.

### Known, not fixed here

Neither `formatDateTime` nor `formatDateTimeShort` pins a `timeZone`, while
`lib/format/recovery.ts` pins `APP_TIMEZONE` specifically to keep SSR and hydration in
agreement. That inconsistency is real but pre-dates this refresh, and correcting it would
shift every rendered timestamp in the app — which does not belong in a dedupe commit.

---

## Stage 7 — Parity: cart recovery and COD get the lead sheet ✅

Stage 4 gave the three sheets a shared *chassis*. They still didn't feel like the same
product, because the two recovery sheets were narrower, laid their fields out differently,
and browsed calls a completely different way.

### The call view finally exists once

`src/components/app/call-detail/` — `CallDetailPane`, `CallSplitView`,
`CapturedFieldGroups`, `TranscriptBody`.

Stage 4 identified that the call view existed **three times** and deferred the merge. It is
merged now, and adopted by **four** surfaces: the lead sheet, the cart sheet, the COD sheet
and the standalone recovery call sheet.

**It takes a structural type, not a view model.** `CallPaneCall` declares the widest field
types — `status: string` where `Call` has an enum, `custom_data: Record<string, unknown>`
where `Call` has a nested record — and `Call`, `RecoveryCallRow` and `CodCallRow` all
satisfy it **as they are**. Two adapter functions would have to stay in sync forever, and
the first time they drifted the surfaces would silently disagree about the same call. This
way, adding a field either already compiles for every caller or fails for all of them.

Recovery and COD gain real capabilities from the merge, not just styling: **turn-by-turn
transcripts** (they only ever showed the raw blob), the **failure alert**, and the
**actionable next step**.

### Rail and pane, not a stack of drawers

Clicking a call in the cart sheet used to open a **second sheet on top of the first** — so
the cart you opened it from was hidden behind the thing you opened, and comparing two calls
on the same cart meant closing and reopening. The Calls tab is now the lead sheet's list-left
/ detail-right rail, and the sheet widened `md` → `lg` to hold it.

The standalone `recovery-call-detail.tsx` survives, but only for the workspace's **own**
Calls table, which lists calls across every cart and so has no parent sheet to embed in. Its
body is now `CallDetailPane`, so it can't drift from the embedded one.

> ⚠️ A panel hosting `CallSplitView` **must** be `<DetailSheetPanel fill>`. The split view
> scrolls each side itself; without `fill` the panel scrolls too and you get two nested
> scrollbars with a rail that drifts out of view.

### Labels left, values right

`DescriptionList` put the label *above* the value in a two-column grid of self-sizing boxes,
so nothing lined up with anything. `dt` and `dd` are now direct children of a
`grid-cols-[auto_minmax(0,1fr)]` list — one label column, one value column, every row
aligned. `span="full"` still drops the label above for paragraphs, product lists and audio.

`minmax(0,1fr)` rather than `1fr` is load-bearing, for the third time in this refresh: plain
`1fr` floors at min-content, and one long unbroken value widens the whole sheet past the
viewport.

### COD had no detail view at all

Not a restyle — **new**. `shopify_cod_confirmations` rows were a read-only table with no
click target, and `calls.cod_confirmation_id` had existed since the feature shipped
(`20260725000000`) with **nothing reading it**. Every confirmation call the section placed
was invisible in the UI.

Added: `getCodCallsForConfirmation` (named columns on an org-scoped admin query — Law #1
applies with force, since `createAdminClient()` is the only tenant boundary there),
`CodCallRow`, `CodConfirmationDetail`, and row-click + keyboard activation on the table.

`codOutcome` moved to `src/lib/cod/status.ts` and returns a **Badge variant** rather than a
class string. It was the one status map Stage 2's semantic-colour pass missed — precisely
*because* it returned `className`, so a grep for raw palette classes found it and a grep for
status→meta maps didn't.

### Sections are outlined cards with a ruled header

A section used to be a bare label over content, separated from its neighbour by a gap. In a
summary made of six of them the eye had nothing to bound each one, so a long description
list and the timeline under it read as one continuous run and the labels looked like they
belonged to whatever was nearest.

`DetailPanel` is now an outlined card: header strip on the sheet's teal wash, a rule beneath
it, then the body. That gives both things at once — a horizontal line per section *and* a
container — without spending a separator between every pair.

> ⚠️ **Nothing bordered goes inside a panel body.** The panel is the frame; a bordered box
> inside it is the double edge Stage 3 removed from `Card`. `CapturedFieldGroups` grew a
> `bare` prop for this, and `NoteCard` was **deleted** — every one of its call sites was
> inside a panel, so it was drawing the second border every time. Panels that are entirely
> prose use `PanelProse`, and `tone="attention"` tints the whole card for the one thing the
> operator should act on.

### The WhatsApp tab

Each message is now a card: template name, the furthest state it actually reached as a
badge, and the timestamp, over a proper vertical rail of Sent → Delivered → Read with a
connector line, filled ticks for what happened and a dashed clock for what hasn't been
reported yet.

The old version put five fixed-width spans on a single line — `w-16` label, `w-20` time,
attribution, then the failure reason **truncated** at the end. So the one field that tells
you what to do about a dead channel ("template not found", "per-user cap reached") was the
one field you couldn't finish reading. Failure detail now gets a full-width tinted line of
its own.

`WhatsAppClickStep` reads as a real terminal step rather than a stray line of text — solid
and success-tinted when the link was opened, dashed and muted when it wasn't. It stays
outside the message cards because the short link belongs to the *attempt*: when retries sent
several messages, we genuinely cannot say which one was clicked.

### Sidebar: three siblings

Cart Recovery and COD Confirmation were rendered as children of Campaigns. They are
independent engines — own settings, queues, tables, metrics — that merely live under
`/campaigns/…` in the URL. Nesting implied they were views *of* a campaign.

This makes `activeNavHref`'s longest-match rule load-bearing rather than merely correct:
`/campaigns/templates/cart-recovery` starts with `/campaigns`, and under the old prefix test
two siblings would light up at once. `Breadcrumbs` now renders nothing on those pages (one
crumb), which is right — the page's `<h1>` already says it.

---

## Stage 8 — Campaigns ✅

### A wrong number on the dashboard

`campaigns/page.tsx` derived **Running / Scheduled / Completed** by filtering `rows` — the
first page of 50. On an org with more campaigns than that, "Running: 2" was simply wrong,
and only one of the three cards admitted it, with an `On this page` hint. New
`getCampaignStatusCounts` counts across the whole org, and the same query feeds the filter
tabs, so a tab and its card can never disagree.

### The list is filterable, and paging respects the filter

Status `NavTabs` (All / Running / Scheduled / Completed, with counts) plus a debounced name
and file search, both URL-driven so a filtered view is shareable and the back button undoes
it. `listCampaigns` gained `q`; `%` and `,` are stripped before interpolation because `,`
separates the branches of PostgREST's `or()` and an unescaped one lets a search box add a
condition to the query.

**The filters are threaded into `fetchPage`.** Without that, scrolling a filtered list
appends *unfiltered* rows — page 1 says "Running" and page 2 quietly includes everything.
The table also remounts on a filter change so infinite scroll restarts rather than appending
across filter sets.

An empty result now distinguishes "no campaigns yet" from "nothing matched" — telling
someone with 200 campaigns to upload a CSV reads as though their data is gone.

### Eight columns to five

`min-w-260` (1040px) inside a layout that already spends 260px on the sidebar meant the
table side-scrolled on most laptops. What went:

- **ID** rendered an 8-character UUID slice on the first line with the campaign name
  *underneath* — so the one thing an operator recognises was the secondary text. Name leads
  now; the file and contact count share the second line.
- **The legend.** Every progress cell carried the same four-item colour key — identical
  words, identical dots, fifty times. It's one `CampaignProgressLegend` in the toolbar, and
  that alone is most of the width that came back.
- **Best disposition** folded under the status badge rather than owning a column.

Run and Stop stay on the row — they're what an operator does from this screen, and burying
them costs a click every time — but they're real `Tooltip`s now instead of `title`
attributes. **Delete moved into a `⋯` menu**; it used to sit one pixel from Download.

`campaign-progress.tsx` holds the maths and the bar, because the detail header now shows the
same thing and a run's progress computed twice is exactly the drift
`CAMPAIGN_STATUS_LABEL` was extracted to stop.

### Stop no longer uses `window.confirm()`

A native OS dialog, in an app with its own — unstyleable, and with nowhere to explain that
in-flight dials finish while queued contacts are skipped. It shares the delete dialog's
machinery via one `confirmAction` state.

### The detail page follows the run

It was a server-rendered snapshot with **no realtime**, while the list page you'd just left
refreshed itself — the one screen you'd sit and watch was the one that never moved. It also
had no progress bar and no Run/Stop, so stopping a campaign you were watching meant
navigating back to the list to find its row.

`CampaignDetailHeader` is a client component that subscribes to campaign realtime, so the
counts, the bar and the whole Performance tab beneath it follow the run. A live campaign's
status badge carries a pulsing dot — the one thing on the page that says a number is still
moving.

### Performance

- **`CONTACT_STATE_META` → Badge variants.** The last survivor of Stage 2's semantic-colour
  pass: it held `bg-warning-muted text-warning` literals, so a grep for raw palette classes
  never flagged it and a grep for status→variant maps never found it. Each state also gained
  a `hint` explaining *why* a contact is waiting, surfaced on the summary chips.
- **The two tables left `ChartFrame`** for `DataTableCard`. They're tables; a chart shell
  gave them a chart's padding and none of the table chrome every other table has.
- **The funnel had two denominators for one word.** Every step was a share of *total* while
  the Connect rate card above was connected ÷ *attempted*. Bar widths stay share-of-total so
  the steps compare visually, and each step now states its conversion from the previous one —
  which is what a funnel measures, and which makes "Connected" agree with the card.

### The call log opens a sheet, with the lead on it

The campaign **Calls** tab (and `/conversations`, which shares
`ConversationsTable`) opened `CallTranscriptDialog` — a centred modal, and the
**last surviving copy** of the call view. So the same call looked like one thing from a
lead, another from a cart, and a third from the campaign call log.

It now opens `CallDetailSheet`, a thin wrapper over the shared `CallDetailPane`. A sheet
also gives a transcript somewhere to go; a centred dialog caps at viewport height and made a
long conversation scroll inside a box inside a box. **`call-transcript-dialog.tsx` is
deleted** — 443 lines, and the third copy the Stage 4 plan set out to remove.

**The Lead panel.** `CallPaneCall` gained optional `lead_name` / `lead_status` /
`lead_intent`, and the panel renders only when they're present. That is what scopes it:

| Surface | Lead panel | Why |
|---|---|---|
| Campaign calls, `/conversations` | ✅ | a call is all you can see; "who is this?" is otherwise unanswerable |
| Cart recovery, COD | ✅ | same |
| Lead sheet's Calls tab | ❌ | you are already inside that lead's sheet |

The lead sheet passes `Call`, which has none of those fields, so it opts out by construction
rather than by a flag someone has to remember to set.

It is deliberately **separate from "Captured on this call"**, which is the immutable snapshot
of what one conversation extracted. A later call can have moved the lead on, and merging the
two would make a stale extraction look current.

Sources differ per surface and all three were already close: `listConversations` widened its
existing lead embed to `(name, phone, status, current_intent)`; recovery rows already carried
exactly these column names; COD calls gained a batched `attachLeads` read — org-scoped as
well as id-scoped, because `createAdminClient()` bypasses RLS and without the org filter a
lead id from another tenant would resolve.

### Scrollbars inside the tabs

`NavTabs` and the campaign tables' scroll containers use `no-scrollbar`. A scrollbar under a
tab row reads as a rendering glitch rather than an affordance — the cut-off tab is the
affordance. Content scrollbars elsewhere are still deliberately visible (see Stage 1).

---

## Verification

Per stage: `npx tsc --noEmit`, `npx eslint <changed>`, `npx vitest run` (logic only — there
is no visual coverage), `npm run build`, then walk the six main screens in **both** themes
at desktop and <768px:

`/dashboard` · `/leads` · `/conversations` · `/campaigns` ·
`/campaigns/templates/cart-recovery` · `/settings`

Stages 1–2 are the ones where a missed token shows as invisible text. Check the sidebar in
**light** mode, every badge state on the cart-recovery screen, and toasts specifically.

Stage 5 adds four states that only exist at runtime and that no test covers:

- **Collapsed rail** — every tooltip appears, and `/campaigns/templates/cart-recovery`
  highlights the Campaigns icon (the `isNavBranchActive` path).
- **Mobile drawer at 360×640** — opens, navigates, and *closes on navigation*.
- **⌘K** — from a page body it opens; from inside a text input it must not.
- **Theme radio** — flipping it moves `<html class="dark">` with no white flash, and
  survives a reload.

A useful trick for token work: after `npm run build`, grep the emitted CSS to prove a new
token produced real utilities rather than silently no-op'ing.

```bash
CSS=$(find .next/static -name "*.css" -size +10k | head -1)
grep -o -- "--sidebar:[^;]*" "$CSS"
```
