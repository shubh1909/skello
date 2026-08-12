#!/usr/bin/env node
// Throwaway diagnostic — why "Intent mix" and "Hot leads" read zero.
//
// READ ONLY. Answers three questions the dashboard cannot distinguish:
//   1. Which definition of dashboard_activity_series is actually live?
//      (20260811000000 counts leads.current_intent by leads.created_at;
//       20260811000001 counts calls.lead_intent_extracted by calls.started_at)
//   2. Does the org have intent data at all, and on which table?
//   3. Do the calls that carry an extraction have a lead_id? The 000001
//      version requires one and silently drops calls without it.
//
// Run from the project root:  node scripts/diagnose-intent-mix.mjs

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

const day = 24 * 60 * 60 * 1000;
const now = Date.now();
const startOfToday = Math.floor(now / day) * day;
// Exactly what the dashboard sends for a 14d range: window start minus one
// more window, so the RPC covers current + comparison period.
const FROM_14D = new Date(startOfToday - 13 * day - 14 * day).toISOString();

const count = async (table, build) => {
  const q = build(admin.from(table).select("id", { count: "exact", head: true }));
  const { count: c, error } = await q;
  return error ? `ERR ${error.code}: ${error.message}` : c;
};

const { data: orgs, error: orgErr } = await admin
  .from("organisations")
  .select("id, name, slug")
  .order("created_at", { ascending: true });
if (orgErr) {
  console.error("orgs:", orgErr);
  process.exit(1);
}

for (const org of orgs ?? []) {
  const id = org.id;
  console.log(`\n===== ${org.name} (${org.slug}) ${id} =====`);

  // --- Raw truth, all time -------------------------------------------------
  const leadsTotal = await count("leads", (q) => q.eq("organisation_id", id));
  const leadsIntent = {};
  for (const v of ["hot", "warm", "cold"]) {
    leadsIntent[v] = await count("leads", (q) =>
      q.eq("organisation_id", id).eq("current_intent", v),
    );
  }
  const callsTotal = await count("calls", (q) => q.eq("organisation_id", id));
  const callsExtracted = await count("calls", (q) =>
    q.eq("organisation_id", id).not("lead_intent_extracted", "is", null),
  );
  const callsExtractedWithLead = await count("calls", (q) =>
    q
      .eq("organisation_id", id)
      .not("lead_intent_extracted", "is", null)
      .not("lead_id", "is", null),
  );
  const callsExtractedNoLead = await count("calls", (q) =>
    q
      .eq("organisation_id", id)
      .not("lead_intent_extracted", "is", null)
      .is("lead_id", null),
  );

  console.log("leads total                     :", leadsTotal);
  console.log("leads.current_intent hot/warm/cold:", leadsIntent);
  console.log("calls total                     :", callsTotal);
  console.log("calls w/ lead_intent_extracted  :", callsExtracted);
  console.log("  ...of those, lead_id present  :", callsExtractedWithLead);
  console.log("  ...of those, lead_id NULL     :", callsExtractedNoLead, "  <- dropped by 000001");

  // Recency: does anything at all fall inside the 14d dashboard window?
  const leadsInWindow = await count("leads", (q) =>
    q.eq("organisation_id", id).gte("created_at", FROM_14D).not("current_intent", "is", null),
  );
  const callsInWindow = await count("calls", (q) =>
    q
      .eq("organisation_id", id)
      .gte("started_at", FROM_14D)
      .not("lead_intent_extracted", "is", null),
  );
  console.log(`leads w/ intent since ${FROM_14D.slice(0, 10)} :`, leadsInWindow);
  console.log(`calls w/ extraction since ${FROM_14D.slice(0, 10)}:`, callsInWindow);

  // --- What the RPC actually returns --------------------------------------
  for (const [label, from] of [
    ["ALL TIME", null],
    ["14d frame", FROM_14D],
  ]) {
    const { data, error } = await admin.rpc("dashboard_activity_series", {
      p_org_id: id,
      p_from: from,
      p_unit: "day",
    });
    if (error) {
      console.log(`RPC ${label}: ERR ${error.code}: ${error.message}`);
      continue;
    }
    const sum = (k) => (data ?? []).reduce((a, r) => a + Number(r[k] ?? 0), 0);
    console.log(
      `RPC ${label}: buckets=${(data ?? []).length} calls=${sum("calls")} connected=${sum(
        "connected",
      )} new_leads=${sum("new_leads")} hot=${sum("hot")} warm=${sum("warm")} cold=${sum("cold")}`,
    );
  }

  const { error: outErr } = await admin.rpc("dashboard_call_outcomes", {
    p_org_id: id,
    p_from: null,
  });
  console.log("dashboard_call_outcomes         :", outErr ? `ERR ${outErr.code}: ${outErr.message}` : "ok");
}
