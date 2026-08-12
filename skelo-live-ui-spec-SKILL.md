---
name: skelo-live-ui-spec
description: Component spec to make the live SKELO product (dashboard + lead drawer) match the approved prototype. Contains exact design tokens, copy-paste HTML/CSS for every component (KPI cards with sparklines, bar chart, intent donut, lead-drawer scorecard with positives/risks), the pure-SVG chart helpers, and the data contracts each component binds to. Use when porting or restyling the SKELO dashboard or lead detail view, or when a developer asks how to build the SKELO UI to match the proto.
---

# SKELO live UI — component spec (dashboard + lead drawer)

Goal: make the live product look **exactly** like the approved prototype. The proto is the source of truth. Copy the tokens and component markup/CSS below verbatim, then bind your real data through the **view-models** in section 5. Do not re-approximate styling from screenshots.

Charts are **pure SVG / CSS** — no chart library. Keep it that way for a pixel match.

---

## 1. Design tokens (set these once, use nothing else)

```css
:root{
  --ivory:#FCFDFB; --ivory-2:#F3F6F4; --card:#FFFFFF; --card-2:#F7FAF8;
  --nav:#00272C; --nav-deep:#001B1F; --nav-hover:rgba(255,255,255,.075);
  --nav-active:#1A525A; --nav-ink:#F0F6F5; --nav-dim:#8AA6AB; --nav-line:rgba(255,255,255,.09);
  --ink:#0F2D32; --ink-soft:#4E6E74; --ink-dim:#8AA6AB;
  --line:#E3EAEB; --line-soft:#E9EEF0;
  --accent:#1A525A; --accent-hover:#123E44; --accent-soft:#FBFFE6; --accent-line:#DFECB8;
  --green:#1E6F52; --green-soft:#E7F0EB;
  --amber:#5E7E84; --amber-soft:#EAF2EC;
  --red:#A8443B; --red-soft:#F5EAE8;
  --shadow-xs:0 1px 2px rgba(0,39,44,.05);
  --shadow:0 1px 3px rgba(0,39,44,.07),0 1px 2px rgba(0,39,44,.04);
  --shadow-lg:0 16px 44px -18px rgba(0,39,44,.28);
  --radius:10px; --radius-sm:8px;
  --font:'Inter',system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
}
body{font-family:var(--font);color:var(--ink);background:var(--ivory)}
.tnum{font-variant-numeric:tabular-nums}
```

Font: Inter (400/500/600/700). Accent for interactive elements is `--accent` (teal); the lime family (`--accent-soft` `#FBFFE6`, `--accent-line` `#DFECB8`) is used for chart fills and soft highlights. Sidebar is `--nav` `#00272C`, active item `--nav-active` `#1A525A`.

---

## 2. Base: panels, buttons, section labels

```css
.panel{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;margin-bottom:18px}
.panel-head{display:flex;align-items:center;gap:14px;padding:14px 18px;border-bottom:1px solid var(--line-soft)}
.panel-head .spacer{flex:1}
.panel-title{font-weight:700;font-size:14.5px}
.panel-pad{padding:18px}
.nm-main{font-weight:600}
.nm-sub{font-size:11.5px;color:var(--ink-dim)}
.sect{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-dim);font-weight:700;margin:24px 0 10px}
.sect:first-child{margin-top:0}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px}
.twocol{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
.btn{display:inline-flex;align-items:center;gap:8px;font-weight:600;font-size:13.5px;border-radius:var(--radius-sm);padding:9px 15px;border:1px solid var(--line);background:var(--card);cursor:pointer}
.btn-primary{background:var(--accent);color:#fff;border-color:var(--accent)}
```

---

## 3. Dashboard components

### 3.1 Chart helper — sparkline (pure SVG)

```js
function spark(data, color){
  const w=104,h=26,mx=Math.max(...data),mn=Math.min(...data);
  const pts=data.map((v,i)=>((i/(data.length-1))*w).toFixed(1)+','+
    (h-3-((v-mn)/((mx-mn)||1))*(h-6)).toFixed(1)).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${color||'var(--accent)'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/></svg>`;
}
```

### 3.2 KPI card (label + value + sparkline + icon chip)

```css
.kpi{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:15px 17px}
.kpi .k-top{display:flex;align-items:center;justify-content:space-between;color:var(--ink-soft);font-size:12.5px;font-weight:500}
.kpi .k-ic{width:30px;height:30px;border-radius:7px;display:grid;place-items:center;flex:none;background:var(--ivory-2);color:var(--ink-soft)}
.kpi .k-ic svg{width:15px;height:15px}
.kpi .k-val{font-size:28px;font-weight:700;letter-spacing:-.02em;margin:9px 0 2px;line-height:1}
.kpi .k-sub{font-size:11.5px;color:var(--ink-dim)}
```

```html
<div class="kpis">
  <div class="kpi">
    <div class="k-top">Leads<span class="k-ic"><!-- 15px line icon --></span></div>
    <div class="k-val tnum">77k</div>
    <div style="margin-top:7px"><!-- spark([...]) --></div>
  </div>
  <!-- repeat for Connect rate, Hot leads, Callback requested -->
</div>
```

Icons: any 1.5–2px stroke line icon (Lucide/Feather), 15px, inside the 30px `k-ic` chip. Use a distinct icon per KPI. Hot-leads sparkline uses `spark(data,'var(--green)')`; callback uses a muted `spark(data,'#5E7E84')`.

### 3.3 Bar chart — "calls per day"

```html
<div class="panel">
  <div class="panel-head"><span class="panel-title">AI calls per day</span><span class="spacer"></span><span class="nm-sub">last 14 days</span></div>
  <div class="panel-pad">
    <div style="display:flex;align-items:flex-end;gap:6px;height:132px">
      <!-- for each value v (max = dmx), last bar highlighted: -->
      <div style="flex:1;text-align:center">
        <div class="tnum" style="font-size:9.5px;color:var(--ink-dim);margin-bottom:3px">4.7</div>
        <div style="height:88px;background:var(--accent-soft);border:1px solid var(--accent-line);border-radius:5px 5px 0 0"></div>
      </div>
      <!-- highlight the latest/active bar with background:var(--accent) instead of --accent-soft -->
    </div>
  </div>
</div>
```
Bar height = `Math.round(v/max*96)` px. Fill `--accent-soft` (cream) with `--accent-line` border; the latest bar uses solid `--accent`.

### 3.4 Donut — "intent mix" (conic-gradient, no library)

```html
<div class="panel">
  <div class="panel-head"><span class="panel-title">Intent mix</span><span class="spacer"></span><span class="nm-sub">called leads</span></div>
  <div class="panel-pad" style="display:flex;align-items:center;gap:26px;justify-content:center">
    <div style="position:relative;width:128px;height:128px;border-radius:50%;
      background:conic-gradient(var(--green) 0 9%, #9EB4B0 9% 56%, var(--red) 56% 100%)">
      <div style="position:absolute;inset:26px;border-radius:50%;background:var(--card);display:grid;place-items:center">
        <div style="text-align:center"><div class="tnum" style="font-weight:700;font-size:17px">4.4k</div><div class="nm-sub" style="font-size:10px">hot</div></div>
      </div>
    </div>
    <div>
      <div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:12.5px"><i style="width:9px;height:9px;border-radius:3px;background:var(--green);display:inline-block"></i><span style="min-width:44px">Hot</span><b class="tnum">9%</b></div>
      <div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:12.5px"><i style="width:9px;height:9px;border-radius:3px;background:#9EB4B0;display:inline-block"></i><span style="min-width:44px">Warm</span><b class="tnum">47%</b></div>
      <div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:12.5px"><i style="width:9px;height:9px;border-radius:3px;background:var(--red);display:inline-block"></i><span style="min-width:44px">Cold</span><b class="tnum">44%</b></div>
    </div>
  </div>
</div>
```
The conic stops are cumulative percentages: `green 0 hot%, #9EB4B0 hot% (hot+warm)%, red (hot+warm)% 100%`.

### 3.5 Summary cards row (Pre-sales / Reactivate / Campaigns)

```html
<div class="grid3">
  <div class="panel" style="margin:0;cursor:pointer">
    <div class="panel-pad" style="display:flex;align-items:center;gap:13px">
      <span class="k-ic" style="width:34px;height:34px;border-radius:8px;display:grid;place-items:center"><!-- icon --></span>
      <div style="flex:1"><div class="nm-main">Pre-sales</div><div class="nm-sub tnum">24k leads · 2.1k hot</div></div>
      <span style="color:var(--ink-dim)">›</span>
    </div>
  </div>
  <!-- repeat -->
</div>
```

---

## 4. Lead drawer components

### 4.1 Drawer shell (right slide-over)

```css
.slideover{position:fixed;top:0;right:0;bottom:0;width:min(760px,94vw);background:var(--ivory);z-index:61;box-shadow:var(--shadow-lg);transform:translateX(102%);transition:transform .22s ease;display:flex;flex-direction:column;overflow:auto}
.slideover.show{transform:none}
```

### 4.2 Header — avatar, name, status, context sub-line, actions

```html
<div style="padding:20px 24px">
  <div style="display:flex;align-items:center;gap:12px">
    <div class="k-ic" style="width:40px;height:40px;border-radius:10px;font-weight:700;color:#fff;background:var(--accent)">KR</div>
    <div style="font-size:19px;font-weight:700">Karan Rao</div>
    <span style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--ink-soft)"><i style="width:8px;height:8px;border-radius:50%;background:var(--amber)"></i>Warm</span>
    <span class="spacer" style="flex:1"></span>
    <button class="btn">Call again</button>
    <button class="btn">WhatsApp</button>
    <button class="btn btn-primary">Assign callback</button>
  </div>
  <div class="nm-sub" style="margin-top:8px">+91 71390 32918 · Godrej Garden City · 2 BHK · Budget ₹40 L · Website Form</div>
</div>
```
Status dot colour: hot → `--green`, warm → `--amber`, cold → `--red`. Keep the context sub-line to one line: `phone · project · config · budget · source`.

### 4.3 Tabs

`AI Summary` (default) · `Call & Transcript` · `Activity`. Active tab: `--ink` text with a 2px `--accent` underline; inactive: `--ink-dim`.

### 4.4 Scorecard — three metric tiles (reuses `.kpi`)

```html
<div class="kpis" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
  <div class="kpi"><div class="k-top">Intent score</div><div class="k-val tnum" style="color:var(--amber)">58</div><div class="k-sub">Warm lead</div></div>
  <div class="kpi"><div class="k-top">Budget fit</div><div class="k-val tnum" style="font-size:21px;padding-top:5px">₹40 L</div><div class="k-sub">Below floor ₹58 L · cross-sell</div></div>
  <div class="kpi"><div class="k-top">Site visit</div><div class="k-val" style="font-size:17px;padding-top:8px">Might be interested</div><div class="k-sub">Loan: Not discussed</div></div>
</div>
```
Intent-score value colour: hot `--green`, warm `--amber`, cold `--red`.

### 4.5 Overall summary

```html
<div class="sect">Overall summary</div>
<div class="panel" style="margin-bottom:16px"><div class="panel-pad" style="font-size:13.5px;line-height:1.65">Karan Rao remains in the market but without urgency...</div></div>
```

### 4.6 Positive signals / Risks & gaps (with proof quotes)

```css
.notecard{border-radius:var(--radius);padding:15px 17px;border:1px solid}
.notecard.pos{background:var(--green-soft);border-color:#CBDFD4}
.notecard.pos .h{color:var(--green)}
.notecard.neg{background:var(--red-soft);border-color:#E6CFCB}
.notecard.neg .h{color:var(--red)}
.notecard .h{font-size:11px;font-weight:700;letter-spacing:.07em;margin-bottom:9px}
.nli{display:flex;gap:9px;margin-bottom:8px;font-size:13px;color:var(--ink)}
.nli i{flex:none;width:6px;height:6px;border-radius:50%;margin-top:7px}
.quote{font-size:12.5px;color:var(--ink-soft);font-style:italic;border-left:2.5px solid var(--accent-line);padding:2px 0 2px 10px;margin:6px 0 12px 15px}
```

```html
<div class="twocol">
  <div class="notecard pos"><div class="h">POSITIVE SIGNALS · WITH PROOF</div>
    <div class="nli"><i style="background:var(--green)"></i><b>Still in market</b></div>
    <div class="quote">"Dekh rahe hain..." · open to options, no urgency.</div>
    <!-- repeat per signal; empty state: <div class="nm-sub">None captured.</div> -->
  </div>
  <div class="notecard neg"><div class="h">RISKS &amp; GAPS</div>
    <div class="nli"><i style="background:var(--red)"></i><b>Budget below project floor</b></div>
    <div class="quote">Stated budget ₹40 L vs project min ₹58 L · cross-sell candidate.</div>
  </div>
</div>
```

---

## 5. Data contracts (what the UI binds to)

The UI renders **only** from these normalized view-models. Never bind components directly to raw Bolna extractions (that is why the current live drawer looks like a raw field dump). Map raw fields into these shapes first (see section 6).

### Dashboard view-model
```json
{
  "kpis": [
    {"label":"Leads","value":"77k","spark":[52,55,58,61,63,68,71,74,77],"icon":"users"},
    {"label":"Connect rate","value":"77%","spark":[61,64,62,68,71,69,74,76,77],"icon":"phone"},
    {"label":"Hot leads","value":"4.4k","spark":[2.1,2.6,3.1,3.9,4.4],"icon":"bolt","tone":"green"},
    {"label":"Callback requested","value":"1,303","spark":[1.4,1.2,1.1,1.0],"icon":"bell","tone":"muted"}
  ],
  "callsPerDay": [3.1,3.4,2.9,3.8,4.1,3.6,4.4,4.0,4.6,4.2,3.9,4.8,5.1,4.7],
  "intentMix": {"hot":9,"warm":47,"cold":44,"hotCount":"4.4k"},
  "summaryCards": [
    {"label":"Pre-sales","sub":"24k leads · 2.1k hot"},
    {"label":"Reactivate leads","sub":"53k in pool · 2.3k hot"},
    {"label":"Campaigns","sub":"3 running · 5 total"}
  ]
}
```

### Lead view-model
```json
{
  "name":"Karan Rao", "initials":"KR",
  "intent":"warm",                       // hot | warm | cold  -> dot + score colour
  "status":"Warm",                        // editable label
  "context":"+91 71390 32918 · Godrej Garden City · 2 BHK · Budget ₹40 L · Website Form",
  "tiles":[                               // exactly 3
    {"label":"Intent score","value":"58","sub":"Warm lead","tone":"warm"},
    {"label":"Budget fit","value":"₹40 L","sub":"Below floor ₹58 L · cross-sell"},
    {"label":"Site visit","value":"Might be interested","sub":"Loan: Not discussed"}
  ],
  "summary":"Karan Rao remains in the market but without urgency...",
  "positives":[ {"h":"Still in market","q":"\"Dekh rahe hain...\""} ],
  "risks":[ {"h":"Budget below project floor","q":"Stated ₹40 L vs min ₹58 L."} ],
  "recordingUrl":"https://..."
}
```

If `positives`/`risks`/score are absent (extraction not ready), render the shells with the empty states shown in 4.6 — never hide the cards.

---

## 6. Fixed shell, swappable bindings (pre-sales vs reactivation)

The layout is a **fixed shell**. Only the *bindings* change per use case. Do NOT hardcode real-estate labels; the three tiles and the two signal lists are generic slots filled by an adapter.

| Slot | Pre-sales binding | Reactivation binding |
|---|---|---|
| Tile 1 | Intent score | Intent score |
| Tile 2 | Budget fit | Prior interest / project |
| Tile 3 | Site visit | Next step (callback) |
| Donut | Intent mix (hot/warm/cold) | Re-engagement outcome |
| KPI 2 | Connect rate | Reconnected % |
| Positives / Risks | same structure, different content | same structure, different content |

**How the different extractions are reconciled** (the important part): raw Bolna output differs per agent/use case, so put an adapter + enrichment step between the webhook and the UI:
1. **Adapter (per use case):** maps raw Bolna fields to the view-model fields and tile labels. Pre-sales agent emits budget/config/site-visit/loan; reactivation agent emits still-in-market/callback-time/intent — each has its own small mapping config.
2. **Enrichment (universal):** a post-call LLM pass reads the transcript and emits the *derived* fields the raw extraction lacks — the numeric `intent score`, `positives[]` and `risks[]` with proof quotes, and the condensed `summary`. It always returns the same shape regardless of use case.
3. Result: both use cases produce an identical view-model, so the same UI renders both. Adding a new use case = one adapter config + one enrichment prompt, zero UI change.

---

## 7. Rules

- Copy tokens and component CSS verbatim; do not restyle.
- Charts stay pure SVG/CSS (sparkline, conic donut, div bars). No chart library.
- No em dashes or en dashes in UI copy; use `·` as a separator (already used throughout).
- Numbers: `77k`, `4.4k`, `1,303`, `₹40 L` (Indian formatting, tabular-nums via `.tnum`).
- Every dynamic card must have an empty state; never collapse a missing card.
- Keep the drawer at `min(760px, 94vw)` and the sidebar active item on `--nav-active`.

## 8. Responsive

```css
@media(max-width:900px){
  .kpis{grid-template-columns:repeat(2,1fr)}
  .twocol,.grid3{grid-template-columns:1fr}
}
```
