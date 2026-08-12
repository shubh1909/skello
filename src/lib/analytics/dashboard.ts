import "server-only";

import { createClient } from "@/lib/supabase/server";
import { warnSkelo } from "@/lib/errors";
import type { CallDirection, CallStatus } from "@/types/call";
import type { LeadIntent } from "@/types/lead";

export type AnalyticsRange = "24h" | "7d" | "14d" | "30d" | "all";

/** Finite ranges only — "all" has no fixed length, which is the point. */
export type FiniteRange = Exclude<AnalyticsRange, "all">;

export const RANGE_DAYS: Record<FiniteRange, number> = {
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
  all: "All time",
};

export function isFiniteRange(range: AnalyticsRange): range is FiniteRange {
  return range !== "all";
}

export function parseRange(raw: string | undefined | null): AnalyticsRange {
  if (
    raw === "24h" ||
    raw === "7d" ||
    raw === "14d" ||
    raw === "30d" ||
    raw === "all"
  ) {
    return raw;
  }
  return "14d";
}

// Above this span, a lifetime view switches from daily to monthly buckets.
// Two years of daily bars is 730 columns in a 132px-tall panel — a texture,
// not a chart. The threshold is where daily still reads as individual days.
const LIFETIME_DAILY_MAX_DAYS = 45;

// Ceiling on rows pulled for the interest breakdown — the one figure still
// counted client-side, because it reads `lead_data` JSONB.
//
// Set to PostgREST's own `max-rows` (1000 on this project), NOT to some larger
// number we would like. That setting caps every response SILENTLY: a
// `.limit(10000)` still returns 1000 rows, with no error and no header the
// client inspects. Asking for more than the server will ever give makes the
// "was this capped?" test — `rows.length >= LIMIT` — permanently false, which
// is how a workspace of 40,000 leads reported exactly 1,000 and looked
// deliberate about it.
const ROW_LIMIT = 1000;

/**
 * A per-day point where `null` means "nothing happened that day", as distinct
 * from "the value was zero".
 *
 * Connect rate needs this. On a day with no calls the rate is undefined, not
 * 0% — plotting it as zero draws a cliff that reads as a collapse in
 * performance when nobody dialled. The sparkline breaks its line across nulls
 * instead.
 */
export type SparkPoint = number | null;

// "Connected" is `status = 'completed'`, and that definition now lives in
// dashboard_activity_series' `count(*) filter (...)`. Keep the two in step.

/** Whether the per-day series is bucketed by day or by month. */
export type BucketUnit = "day" | "month";

export interface DashboardAnalytics {
  range: AnalyticsRange;
  /** Granularity of every `date`-keyed series below. */
  bucketUnit: BucketUnit;
  /**
   * True when the interest breakdown was computed from a capped sample rather
   * than every row. Every other figure is aggregated in SQL and therefore
   * exact; this one still counts rows because it reads JSONB.
   */
  interestSampled: boolean;
  /**
   * Which reads failed, and what the database said.
   *
   * Split per query rather than one page-wide flag. The two are independent:
   * the outcomes panel going down says nothing about whether the KPI numbers
   * are sound, and a single banner over four correct figures teaches people to
   * distrust a working dashboard.
   *
   * `message` carries the database's own wording. "A query failed, check the
   * logs" is not a diagnosis — the actual text names the missing function.
   */
  errors: {
    /** Fatal: every headline number and series is zero by default, not by measurement. */
    series: string | null;
    /** Contained: only the call-outcomes panel is affected. */
    outcomes: string | null;
  };
  /** First lead or call this workspace ever recorded. Only set on "all time". */
  earliestActivityAt: string | null;
  /** False for "all time", where there is no prior period to compare against. */
  hasComparison: boolean;
  totalCalls: { current: number; previous: number };
  /** Leads created in the window, and in the window before it. */
  newLeads: { current: number; previous: number };
  /**
   * Share of placed calls that completed, 0-100. Denominator is every `calls`
   * row in the window — one row per dial — so this reads as "of the calls we
   * placed, how many connected".
   */
  connectRate: { current: number; previous: number };
  /** Calls placed per day, for the hero bar chart. */
  callsDaily: Array<{ date: string; count: number }>;
  /** Daily connect rate; null on days with no calls (see SparkPoint). */
  connectRateDaily: Array<{ date: string; rate: SparkPoint }>;
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

/**
 * One bucket from `dashboard_activity_series`.
 *
 * Counts arrive as strings: Postgres `bigint` exceeds what JSON numbers
 * guarantee, so PostgREST serialises them as text. Every read goes through
 * `Number()` — treating them as numbers directly makes `+` concatenate.
 */
interface SeriesRow {
  bucket: string;
  calls: number | string;
  connected: number | string;
  new_leads: number | string;
  hot: number | string;
  warm: number | string;
  cold: number | string;
}

interface OutcomeRow {
  status: string;
  total: number | string;
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
  return null;
}

/** `YYYY-MM-DD` for a day bucket, `YYYY-MM` for a month one. */
export function bucketKey(iso: string, unit: BucketUnit): string {
  const s = new Date(iso).toISOString();
  return unit === "day" ? s.slice(0, 10) : s.slice(0, 7);
}

/** Every month from `earliestIso` to the month containing `now`, inclusive. */
export function monthBuckets(earliestIso: string, now: number): string[] {
  const start = new Date(earliestIso);
  const end = new Date(now);
  const endIndex = end.getUTCFullYear() * 12 + end.getUTCMonth();
  const out: string[] = [];
  for (
    let i = start.getUTCFullYear() * 12 + start.getUTCMonth();
    i <= endIndex;
    i++
  ) {
    out.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

/**
 * Buckets for an all-time view, sized to how much history actually exists.
 *
 * A fixed 14 daily buckets would show a two-year-old workspace its last two
 * weeks and call it "all time" — the one label that promises otherwise. So the
 * span decides: short histories stay daily, long ones roll up to months.
 *
 * With no data at all there is no span to measure; fall back to a 30-day daily
 * frame so the charts render their empty state at a sensible width rather than
 * collapsing to nothing.
 */
export function lifetimeBuckets(
  earliestIso: string | null,
  now: number,
): { unit: BucketUnit; buckets: string[] } {
  if (!earliestIso) return { unit: "day", buckets: dayBuckets(now, 30) };

  const day = 24 * 60 * 60 * 1000;
  const spanDays =
    Math.floor((now - new Date(earliestIso).getTime()) / day) + 1;

  if (spanDays <= LIFETIME_DAILY_MAX_DAYS) {
    return { unit: "day", buckets: dayBuckets(now, Math.max(spanDays, 1)) };
  }
  return { unit: "month", buckets: monthBuckets(earliestIso, now) };
}

export interface DashboardSeries {
  callsDaily: Array<{ date: string; count: number }>;
  connectRateDaily: Array<{ date: string; rate: SparkPoint }>;
  newLeadsDaily: Array<{ date: string; count: number }>;
  leadTemperatureDaily: Array<{
    date: string;
    hot: number;
    warm: number;
    cold: number;
  }>;
  totals: { calls: number; connected: number; leads: number };
  hot: number;
  warm: number;
  cold: number;
  /** Everything that fell BEFORE the frame — i.e. the comparison window. */
  previous: { calls: number; connected: number; leads: number };
}

/**
 * Fold aggregated bucket rows onto the frame the UI will draw.
 *
 * Pure and exported so two things can be pinned by a test.
 *
 * **A bucket with no calls yields `rate: null`, never `0`.** Zero says "we
 * dialled and nobody answered"; null says "we didn't dial". Drawn as zero it
 * looks like a collapse in performance on any day the team was off.
 *
 * **Rows before the frame's first bucket become the comparison window.** One
 * query covers both periods, so the split has to happen here rather than in
 * SQL — and getting it backwards silently swaps every delta's sign.
 */
export function buildSeries(
  rows: readonly SeriesRow[],
  buckets: readonly string[],
  unit: BucketUnit = "day",
): DashboardSeries {
  const boundary = buckets[0] ?? "";
  const byBucket = new Map<string, SeriesRow>();
  const previous = { calls: 0, connected: 0, leads: 0 };

  for (const r of rows) {
    const key = bucketKey(r.bucket, unit);
    if (key >= boundary) {
      byBucket.set(key, r);
    } else {
      previous.calls += Number(r.calls);
      previous.connected += Number(r.connected);
      previous.leads += Number(r.new_leads);
    }
  }

  const at = (key: string) => byBucket.get(key);
  const sum = (pick: (r: SeriesRow) => number | string) =>
    [...byBucket.values()].reduce((acc, r) => acc + Number(pick(r)), 0);

  return {
    callsDaily: buckets.map((date) => ({
      date,
      count: Number(at(date)?.calls ?? 0),
    })),
    connectRateDaily: buckets.map((date) => {
      const total = Number(at(date)?.calls ?? 0);
      return {
        date,
        rate:
          total === 0 ? null : (Number(at(date)?.connected ?? 0) / total) * 100,
      };
    }),
    newLeadsDaily: buckets.map((date) => ({
      date,
      count: Number(at(date)?.new_leads ?? 0),
    })),
    leadTemperatureDaily: buckets.map((date) => ({
      date,
      hot: Number(at(date)?.hot ?? 0),
      warm: Number(at(date)?.warm ?? 0),
      cold: Number(at(date)?.cold ?? 0),
    })),
    totals: {
      calls: sum((r) => r.calls),
      connected: sum((r) => r.connected),
      leads: sum((r) => r.new_leads),
    },
    hot: sum((r) => r.hot),
    warm: sum((r) => r.warm),
    cold: sum((r) => r.cold),
    previous,
  };
}

export function dayBuckets(now: number, days: number): string[] {
  const day = 24 * 60 * 60 * 1000;
  const startOfToday = Math.floor(now / day) * day;
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(new Date(startOfToday - i * day).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * The timestamp of this workspace's first lead or call, or null if it has
 * neither. Two indexed `limit 1` reads — cheap enough to ask directly, and the
 * only way to be right about "all time" once a workspace outgrows ROW_LIMIT.
 */
async function earliestActivity(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
): Promise<string | null> {
  const [firstLead, firstCall] = await Promise.all([
    supabase
      .from("leads")
      .select("created_at")
      .eq("organisation_id", orgId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle<{ created_at: string }>(),
    supabase
      .from("calls")
      .select("started_at")
      .eq("organisation_id", orgId)
      .order("started_at", { ascending: true })
      .limit(1)
      .maybeSingle<{ started_at: string }>(),
  ]);

  const candidates = [
    firstLead.data?.created_at,
    firstCall.data?.started_at,
  ].filter((v): v is string => Boolean(v));

  // ISO-8601 sorts lexicographically, so the smallest string is the oldest.
  return candidates.length > 0 ? candidates.sort()[0] : null;
}

export async function getDashboardAnalytics(input: {
  orgSlug: string;
  orgId: string;
  range: AnalyticsRange;
}): Promise<DashboardAnalytics> {
  const { orgId, range } = input;
  const lifetime = !isFiniteRange(range);
  const days = lifetime ? 0 : RANGE_DAYS[range];
  const supabase = await createClient();

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const startOfToday = Math.floor(now / day) * day;

  const earliestActivityAt = lifetime
    ? await earliestActivity(supabase, orgId)
    : null;

  // The frame first: on all-time it runs from this workspace's first record and
  // rolls up to months once daily bars stop being legible.
  const { unit: bucketUnit, buckets } = lifetime
    ? lifetimeBuckets(earliestActivityAt, now)
    : { unit: "day" as const, buckets: dayBuckets(now, days) };

  // Windows are DAY-ALIGNED to match the buckets. A rolling "now minus 14×24h"
  // boundary lands mid-bucket, so the oldest bar covered part of a day while
  // every other bar covered all of one — a shorter first column that looked
  // like a dip in activity.
  const windowStartMs = lifetime ? null : startOfToday - (days - 1) * day;
  const fromIso =
    windowStartMs === null
      ? null
      : new Date(windowStartMs - days * day).toISOString();

  const [seriesResult, outcomesResult] = await Promise.all([
    supabase.rpc("dashboard_activity_series", {
      p_org_id: orgId,
      p_from: fromIso,
      p_unit: bucketUnit,
    }),
    supabase.rpc("dashboard_call_outcomes", {
      p_org_id: orgId,
      p_from: fromIso,
    }),
  ]);

  if (seriesResult.error) {
    warnSkelo("ANALYTICS", "Activity series failed; falling back to zeros", {
      organisationId: orgId,
      cause: seriesResult.error,
    });
  }
  if (outcomesResult.error) {
    warnSkelo("ANALYTICS", "Call outcomes failed; falling back to empty", {
      organisationId: orgId,
      cause: outcomesResult.error,
    });
  }
  const seriesRows = (seriesResult.data ?? []) as SeriesRow[];

  const series = buildSeries(seriesRows, buckets, bucketUnit);
  const {
    callsDaily,
    connectRateDaily,
    newLeadsDaily,
    leadTemperatureDaily,
  } = series;

  const pct = (part: number, whole: number) =>
    whole === 0 ? 0 : (part / whole) * 100;

  const totalCalls = {
    current: series.totals.calls,
    previous: series.previous.calls,
  };
  const newLeads = {
    current: series.totals.leads,
    previous: series.previous.leads,
  };
  const connectRate = {
    current: pct(series.totals.connected, series.totals.calls),
    previous: pct(series.previous.connected, series.previous.calls),
  };
  const leadTemperatureTotals = {
    hot: series.hot,
    warm: series.warm,
    cold: series.cold,
  };

  const callOutcomes = ((outcomesResult.data ?? []) as OutcomeRow[]).map(
    (r) => ({ status: r.status as CallStatus, count: Number(r.total) }),
  );

  // Interest is the one figure still counted from rows, because it lives in
  // `lead_data` JSONB and falls back to a per-call field. It is a TOP-N list
  // rather than a total, so a recent sample is defensible where a capped total
  // would not be — but the panel says so rather than implying completeness.
  const interestFrom = fromIso ?? undefined;
  const leadsQuery = supabase
    .from("leads")
    .select("created_at, current_intent, lead_data, phone")
    .eq("organisation_id", orgId);
  const leadsResult = await (interestFrom
    ? leadsQuery.gte("created_at", interestFrom)
    : leadsQuery
  )
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT);
  if (leadsResult.error) {
    warnSkelo("ANALYTICS", "Leads query failed; falling back to empty set", {
      organisationId: orgId,
      cause: leadsResult.error,
    });
  }
  const leads = (leadsResult.data ?? []) as LeadRow[];

  const callsQuery = supabase
    .from("calls")
    .select(
      "started_at, status, duration_seconds, direction, to_phone, from_phone, interest",
    )
    .eq("organisation_id", orgId);
  const callsResult = await (interestFrom
    ? callsQuery.gte("started_at", interestFrom)
    : callsQuery
  )
    .order("started_at", { ascending: false })
    .limit(ROW_LIMIT);
  const calls = (callsResult.data ?? []) as CallRow[];

  // A query that failed and a workspace with no data both produce zeros, and
  // rendering "0" for the first is a wrong number wearing the clothes of a
  // right one. Carry the distinction — and the database's own wording — to the
  // UI, per query, so a dead panel doesn't discredit correct figures.
  const errors = {
    series: seriesResult.error?.message ?? null,
    outcomes: outcomesResult.error?.message ?? null,
  };

  console.log("[analytics] dashboard", {
    organisationId: orgId,
    range,
    bucketUnit,
    buckets: buckets.length,
    seriesRows: seriesRows.length,
    totalCalls: totalCalls.current,
    newLeads: newLeads.current,
    earliestActivityAt,
    errors,
  });

  const leadsCurrent = leads;
  const callsCurrent = calls;

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

  return {
    range,
    bucketUnit,
    interestSampled: leads.length >= ROW_LIMIT || calls.length >= ROW_LIMIT,
    errors,
    earliestActivityAt,
    hasComparison: !lifetime,
    totalCalls,
    newLeads,
    connectRate,
    callsDaily,
    connectRateDaily,
    newLeadsDaily,
    interestMentions,
    leadTemperatureDaily,
    leadTemperatureTotals,
    callOutcomes,
    totalInterestMentions,
  };
}
