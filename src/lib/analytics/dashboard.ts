import "server-only";

import { createClient } from "@/lib/supabase/server";
import { warnSkelo } from "@/lib/errors";
import type { CallDirection, CallStatus } from "@/types/call";
import type { LeadIntent } from "@/types/lead";

export type AnalyticsRange = "24h" | "7d" | "14d" | "30d";

export const RANGE_DAYS: Record<AnalyticsRange, number> = {
  "24h": 1,
  "7d": 7,
  "14d": 14,
  "30d": 30,
};

export const RANGE_LABEL: Record<AnalyticsRange, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "14d": "Last 14 days",
  "30d": "Last 30 days",
};

export function parseRange(raw: string | undefined | null): AnalyticsRange {
  if (raw === "24h" || raw === "7d" || raw === "14d" || raw === "30d") {
    return raw;
  }
  return "14d";
}

export interface DashboardAnalytics {
  range: AnalyticsRange;
  totalCalls: { current: number; previous: number };
  uniqueUsers: { current: number; previous: number };
  avgDurationSec: { current: number; previous: number };
  qualifiedRate: { current: number; previous: number };
  newLeadsDaily: Array<{ date: string; count: number }>;
  interestMentions: Array<{ interest: string; count: number }>;
  leadTemperatureDaily: Array<{
    date: string;
    hot: number;
    warm: number;
    cold: number;
  }>;
  leadTemperatureTotals: { hot: number; warm: number; cold: number };
  callOutcomes: Array<{ status: CallStatus; count: number }>;
  totalInterestMentions: number;
}

// Post-remodel: `lead_intent` and `interest` columns are gone. The lead's
// current intent now lives on `current_intent`; the interest the LLM
// captured lives inside `lead_data` (rolled-up to the lead row) or on
// individual call snapshots. We read both sources here.
interface LeadRow {
  created_at: string;
  current_intent: LeadIntent | null;
  lead_data: Record<string, unknown> | null;
  phone: string | null;
}

interface CallRow {
  started_at: string;
  status: CallStatus;
  duration_seconds: number | null;
  direction: CallDirection;
  to_phone: string | null;
  from_phone: string | null;
  interest: string | null;
}

function counterpartyPhone(c: CallRow): string | null {
  return c.direction === "inbound" ? c.from_phone : c.to_phone;
}

function pickInterest(lead: LeadRow): string | null {
  const ld = lead.lead_data;
  if (!ld) return null;
  const direct = ld.interest;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const product = ld.product;
  if (typeof product === "string" && product.trim()) return product.trim();
  return null;
}

function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function dayBuckets(now: number, days: number): string[] {
  const day = 24 * 60 * 60 * 1000;
  const startOfToday = Math.floor(now / day) * day;
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(new Date(startOfToday - i * day).toISOString().slice(0, 10));
  }
  return out;
}

export async function getDashboardAnalytics(input: {
  orgSlug: string;
  orgId: string;
  range: AnalyticsRange;
}): Promise<DashboardAnalytics> {
  const { orgId, range } = input;
  const days = RANGE_DAYS[range];
  const supabase = await createClient();

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const windowStart = new Date(now - days * day).toISOString();
  const prevWindowStart = new Date(now - 2 * days * day).toISOString();

  const leadsResult = await supabase
    .from("leads")
    .select("created_at, current_intent, lead_data, phone")
    .eq("organisation_id", orgId)
    .gte("created_at", prevWindowStart)
    .order("created_at", { ascending: false })
    .limit(10_000);
  if (leadsResult.error) {
    warnSkelo("ANALYTICS", "Leads query failed; falling back to empty set", {
      organisationId: orgId,
      cause: leadsResult.error,
    });
  }
  const leads = (leadsResult.data ?? []) as LeadRow[];

  const callsResult = await supabase
    .from("calls")
    .select(
      "started_at, status, duration_seconds, direction, to_phone, from_phone, interest",
    )
    .eq("organisation_id", orgId)
    .gte("started_at", prevWindowStart)
    .order("started_at", { ascending: false })
    .limit(10_000);
  if (callsResult.error) {
    warnSkelo("ANALYTICS", "Calls query failed; falling back to empty set", {
      organisationId: orgId,
      cause: callsResult.error,
    });
  }
  const calls = (callsResult.data ?? []) as CallRow[];

  const inCurrent = (iso: string) => iso >= windowStart;
  const inPrevious = (iso: string) => iso >= prevWindowStart && iso < windowStart;

  const callsCurrent = calls.filter((c) => inCurrent(c.started_at));
  const callsPrevious = calls.filter((c) => inPrevious(c.started_at));

  const totalCalls = {
    current: callsCurrent.length,
    previous: callsPrevious.length,
  };

  const uniquePhones = (rows: CallRow[]) => {
    const set = new Set<string>();
    for (const c of rows) {
      const phone = counterpartyPhone(c);
      if (phone) set.add(phone);
    }
    return set.size;
  };
  const uniqueUsers = {
    current: uniquePhones(callsCurrent),
    previous: uniquePhones(callsPrevious),
  };

  const avg = (rows: CallRow[]) => {
    const done = rows.filter(
      (r) => r.status === "completed" && typeof r.duration_seconds === "number",
    );
    if (done.length === 0) return 0;
    const total = done.reduce((sum, r) => sum + (r.duration_seconds ?? 0), 0);
    return Math.round(total / done.length);
  };
  const avgDurationSec = {
    current: avg(callsCurrent),
    previous: avg(callsPrevious),
  };

  const qualifiedPct = (rows: LeadRow[]) => {
    if (rows.length === 0) return 0;
    const q = rows.filter(
      (l) => l.current_intent === "hot" || l.current_intent === "warm",
    ).length;
    return (q / rows.length) * 100;
  };
  const leadsCurrent = leads.filter((l) => inCurrent(l.created_at));
  const leadsPrevious = leads.filter((l) => inPrevious(l.created_at));
  const qualifiedRate = {
    current: qualifiedPct(leadsCurrent),
    previous: qualifiedPct(leadsPrevious),
  };

  const buckets = dayBuckets(now, days);

  const newLeadsMap = new Map<string, number>(buckets.map((b) => [b, 0]));
  for (const l of leadsCurrent) {
    const key = dayKey(l.created_at);
    if (newLeadsMap.has(key)) {
      newLeadsMap.set(key, (newLeadsMap.get(key) ?? 0) + 1);
    }
  }
  const newLeadsDaily = buckets.map((date) => ({
    date,
    count: newLeadsMap.get(date) ?? 0,
  }));

  const tempMap = new Map<
    string,
    { hot: number; warm: number; cold: number }
  >(buckets.map((b) => [b, { hot: 0, warm: 0, cold: 0 }]));
  for (const l of leadsCurrent) {
    const key = dayKey(l.created_at);
    const bucket = tempMap.get(key);
    if (!bucket) continue;
    if (l.current_intent === "hot") bucket.hot += 1;
    else if (l.current_intent === "warm") bucket.warm += 1;
    else if (l.current_intent === "cold") bucket.cold += 1;
  }
  const leadTemperatureDaily = buckets.map((date) => ({
    date,
    ...(tempMap.get(date) ?? { hot: 0, warm: 0, cold: 0 }),
  }));
  const leadTemperatureTotals = leadTemperatureDaily.reduce(
    (acc, d) => ({
      hot: acc.hot + d.hot,
      warm: acc.warm + d.warm,
      cold: acc.cold + d.cold,
    }),
    { hot: 0, warm: 0, cold: 0 },
  );

  // Interest counts: prefer the lead's rolled-up lead_data.interest, fall
  // back to the most recent call's interest (caught via callsCurrent below
  // for any lead whose lead_data didn't have one).
  const interestCounts = new Map<string, number>();
  for (const l of leadsCurrent) {
    const interest = pickInterest(l);
    if (!interest) continue;
    interestCounts.set(interest, (interestCounts.get(interest) ?? 0) + 1);
  }
  // Second pass: pick up calls whose lead's lead_data didn't surface an
  // interest. Dedupes by counterparty phone so the same lead isn't double
  // counted across multiple calls.
  const seenPhones = new Set<string>();
  for (const c of callsCurrent) {
    const interest = c.interest?.trim();
    if (!interest) continue;
    const phone = counterpartyPhone(c);
    if (!phone || seenPhones.has(phone)) continue;
    seenPhones.add(phone);
    if (interestCounts.has(interest)) continue;
    interestCounts.set(interest, (interestCounts.get(interest) ?? 0) + 1);
  }
  const interestMentions = [...interestCounts.entries()]
    .map(([interest, count]) => ({ interest, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const totalInterestMentions = [...interestCounts.values()].reduce(
    (a, b) => a + b,
    0,
  );

  const outcomeCounts = new Map<CallStatus, number>();
  for (const c of callsCurrent) {
    outcomeCounts.set(c.status, (outcomeCounts.get(c.status) ?? 0) + 1);
  }
  const callOutcomes = [...outcomeCounts.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  return {
    range,
    totalCalls,
    uniqueUsers,
    avgDurationSec,
    qualifiedRate,
    newLeadsDaily,
    interestMentions,
    leadTemperatureDaily,
    leadTemperatureTotals,
    callOutcomes,
    totalInterestMentions,
  };
}
