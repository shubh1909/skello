import {
  BellIcon,
  CalendarIcon,
  FlameIcon,
  HeadphonesIcon,
  MessagesSquareIcon,
  PhoneCallIcon,
  PhoneIcon,
  UserPlusIcon,
  UsersIcon,
  ZapIcon,
} from "lucide-react";

import { SectionLabel } from "@/components/app/section-label";
import { ActivityBarChart } from "@/components/app/analytics/activity-bar-chart";
import { CallOutcomes } from "@/components/app/analytics/call-outcomes";
import { ChartFrame } from "@/components/app/analytics/chart-frame";
import { HorizontalBarList } from "@/components/app/analytics/horizontal-bar-list";
import { IntentDonut } from "@/components/app/analytics/intent-donut";
import { KpiCard } from "@/components/app/analytics/kpi-card";
import { RangeToggle } from "@/components/app/analytics/range-toggle";
import { WidgetRenderer } from "@/components/app/analytics/widget-renderer";
import { NavStatCard } from "@/components/app/nav-stat-card";
import { VoiceAgentBanner } from "@/components/app/voice-agent-banner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getBolnaIntegration } from "@/actions/bolna-integrations";
import {
  getDashboardActionCards,
  type DashboardActionCards,
} from "@/actions/dashboard-cards";
import { executeOrgWidgets } from "@/actions/dashboard-widgets";
import {
  type AnalyticsRange,
  RANGE_DAYS,
  RANGE_LABEL,
  getDashboardAnalytics,
  isFiniteRange,
  parseRange,
} from "@/lib/analytics/dashboard";
import { requireSession } from "@/lib/auth/session";
import type { WidgetExecuteRow } from "@/lib/validations/dashboard-widget";
import type { OrgDashboardWidget } from "@/types/dashboard-widget";

export const metadata = { title: "Analytics · Skelo" };

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const session = await requireSession();
  const sp = (await searchParams) ?? {};
  const rawRange = Array.isArray(sp.range) ? sp.range[0] : sp.range;
  const range = parseRange(rawRange);

  // Custom widgets ADD to the default dashboard; they no longer replace it.
  //
  // The original contract swapped the whole page the moment a single widget
  // was enabled. That made a configured org lose every default chart as a side
  // effect of adding one of their own — and it hid the default dashboard from
  // exactly the orgs furthest along in setting the product up, who are the
  // least likely to report it missing. Both layouts now render, defaults
  // first, so a widget is an addition rather than a trade.
  const [analytics, integrationResult, widgetsResult, cardsResult] =
    await Promise.all([
      getDashboardAnalytics({
        orgSlug: session.organisation.slug,
        orgId: session.organisation.id,
        range,
      }),
      getBolnaIntegration(session.organisation.id),
      executeOrgWidgets(),
      getDashboardActionCards(),
    ]);
  const integration = integrationResult.success ? integrationResult.data : null;
  const customWidgets = widgetsResult.success ? widgetsResult.data : [];
  const hasCustomDashboard = customWidgets.length > 0;
  const cards = cardsResult.success ? cardsResult.data : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1.5">
          <SectionLabel as="p">
            Analytics
          </SectionLabel>
          <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            {greeting()}, {session.email.split("@")[0]}.
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {`${RANGE_LABEL[range]} · ${session.organisation.name}`}
          </p>
        </div>
        {/* The range drives the default dashboard, which now always renders,
            so the toggle is always meaningful. Custom widgets carry their own
            per-widget range and are unaffected by it. */}
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-card px-2.5 py-1.5 text-xs text-muted-foreground">
            <CalendarIcon className="size-3.5" />
            {RANGE_LABEL[range]}
          </span>
          <RangeToggle value={range} />
        </div>
      </header>

      <VoiceAgentBanner integration={integration} />

      <LeadDashboard
        analytics={analytics}
        range={range}
        orgName={session.organisation.name}
        cards={cards}
      />

      {hasCustomDashboard ? (
        <section className="space-y-2.5">
          {/* Labelled, because these are the org's own widgets and each
              carries its own range — without a boundary they read as more
              default charts that inexplicably ignore the range toggle. */}
          <SectionLabel as="h3">Custom widgets</SectionLabel>
          <CustomDashboard
            items={customWidgets}
            orgName={session.organisation.name}
          />
        </section>
      ) : null}
    </div>
  );
}

function CustomDashboard({
  items,
  orgName,
}: {
  items: Array<{ widget: OrgDashboardWidget; rows: WidgetExecuteRow[] }>;
  orgName: string;
}) {
  // 2-column desktop grid. Wide widgets (pivot tables, time-bucketed
  // bar / line charts) span both columns so they have room to breathe;
  // stat cards and categorical bar/pie stay single-column. Same
  // breathing room as the legacy dashboard.
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-2">
      {items.map(({ widget, rows }) => {
        const cfg = widget.config;
        const wide =
          cfg.chart_type === "pivot" ||
          cfg.chart_type === "line" ||
          (cfg.chart_type === "bar" &&
            cfg.kind !== "sql" &&
            Boolean(cfg.row_dimension?.bucket));
        const rangeLabel =
          cfg.kind === "sql" ? "Custom SQL" : rangeLabelFor(cfg.range);
        return (
          <div
            key={widget.id}
            className={wide ? "md:col-span-2" : undefined}
          >
            <WidgetRenderer
              widget={widget}
              rows={rows}
              subtitle={`${rangeLabel} · ${orgName}`}
              wide={wide}
            />
          </div>
        );
      })}
    </div>
  );
}

interface LeadDashboardProps {
  analytics: Awaited<ReturnType<typeof getDashboardAnalytics>>;
  range: AnalyticsRange;
  orgName: string;
  cards: DashboardActionCards | null;
}

/**
 * Leads in, conversations had, what came out.
 *
 * Cart recovery and COD confirmation deliberately do NOT appear here — they
 * have their own overview screens, and their metrics are lifetime totals that
 * would sit unmoved beside a range toggle, inviting exactly the wrong
 * comparison.
 */
function LeadDashboard({
  analytics,
  range,
  orgName,
  cards,
}: LeadDashboardProps) {
  const leadsDelta = pctDelta(
    analytics.newLeads.current,
    analytics.newLeads.previous,
  );
  const callsDelta = pctDelta(
    analytics.totalCalls.current,
    analytics.totalCalls.previous,
  );
  // Percentage points, not a percentage of a percentage: 40% → 50% is +10pp,
  // and calling that "+25%" is the classic way to overstate a rate change.
  const connectDelta =
    Math.round(
      (analytics.connectRate.current - analytics.connectRate.previous) * 10,
    ) / 10;

  // "All time" has no prior period, so every delta is suppressed rather than
  // rendered as a meaningless +0%. Each card falls back to a hint that says
  // what the number covers.
  const comparing = analytics.hasComparison;
  const period = isFiniteRange(range)
    ? `vs. previous ${RANGE_DAYS[range]}d`
    : "";
  const lifetimeHint = "since this workspace began";
  const grain = analytics.bucketUnit === "month" ? "per month" : "per day";

  const t = analytics.leadTemperatureTotals;
  const classified = t.hot + t.warm + t.cold;

  return (
    <>
      {/* Only the SERIES failing invalidates the page. The outcomes panel is
          reported inside that panel instead — a page-wide banner over four
          correct figures teaches people to distrust a working dashboard. */}
      {analytics.errors.series ? (
        <Alert variant="destructive">
          <AlertTitle>Analytics could not be loaded</AlertTitle>
          <AlertDescription>
            Every figure below is zero by default rather than by measurement —
            these are not your real numbers. The database said:
            <br />
            <code className="mt-1 inline-block">{analytics.errors.series}</code>
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="New leads"
          value={analytics.newLeads.current.toLocaleString()}
          icon={<UserPlusIcon />}
          spark={analytics.newLeadsDaily.map((d) => d.count)}
          delta={
            comparing ? { value: leadsDelta, suffix: "%", period } : undefined
          }
          hint={comparing ? undefined : lifetimeHint}
        />
        <KpiCard
          label="Conversations"
          value={analytics.totalCalls.current.toLocaleString()}
          icon={<MessagesSquareIcon />}
          spark={analytics.callsDaily.map((d) => d.count)}
          delta={
            comparing ? { value: callsDelta, suffix: "%", period } : undefined
          }
          hint={comparing ? undefined : lifetimeHint}
        />
        <KpiCard
          label="Connect rate"
          value={`${analytics.connectRate.current.toFixed(1)}%`}
          icon={<PhoneCallIcon />}
          // Gapped where nobody dialled — see SparkPoint.
          spark={analytics.connectRateDaily.map((d) => d.rate)}
          delta={
            comparing ? { value: connectDelta, suffix: "pp", period } : undefined
          }
          hint={comparing ? undefined : lifetimeHint}
        />
        <KpiCard
          label="Hot leads"
          value={analytics.leadTemperatureTotals.hot.toLocaleString()}
          icon={<FlameIcon />}
          spark={analytics.leadTemperatureDaily.map((d) => d.hot)}
          sparkColor="var(--destructive)"
          // Against leads the agent actually CLASSIFIED, not against every
          // lead created. A workspace that took 1,000 carts and called 40 of
          // them is not "4 hot out of 1,000" — that reads as a failure when
          // the other 960 were simply never spoken to.
          hint={`of ${classified.toLocaleString()} classified by a call`}
        />
      </section>

      <section className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        {/* The title follows the bucket unit. On a long all-time span the
            series rolls up to months, and a panel headed "per day" showing
            monthly bars is a straightforward lie about the x-axis. */}
        <ChartFrame
          icon={PhoneIcon}
          title={`Conversations ${grain}`}
          subtitle={`${RANGE_LABEL[range]} · ${orgName}`}
        >
          <ActivityBarChart
            data={analytics.callsDaily}
            unit="conversation"
            emptyLabel={
              isFiniteRange(range)
                ? undefined
                : "No conversations recorded yet."
            }
          />
        </ChartFrame>

        <ChartFrame
          icon={FlameIcon}
          title="Intent mix"
          // Says what it counts. This is not every lead — it is the ones a
          // conversation classified, which is the only place intent comes
          // from. A cart that was never called has no temperature.
          subtitle={`Leads classified by a call · ${RANGE_LABEL[range].toLowerCase()}`}
        >
          <IntentDonut
            totals={analytics.leadTemperatureTotals}
            emptyLabel="No calls have captured an intent in this window yet."
          />
        </ChartFrame>
      </section>

      <section className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        {/* The only panel still counted from rows rather than aggregated in
            SQL — interest lives in JSONB. It is a top-N list, so a recent
            sample is defensible, but the subtitle says so instead of implying
            it covers everything. */}
        <ChartFrame
          icon={ZapIcon}
          title="Lead interest"
          subtitle={
            analytics.interestSampled
              ? "What leads are asking about · most recent 1,000"
              : "What leads are asking about"
          }
        >
          <HorizontalBarList
            items={analytics.interestMentions.map((p) => ({
              label: p.interest,
              value: p.count,
            }))}
            total={analytics.totalInterestMentions}
            totalLabel="Total mentions"
            emptyLabel="No interest tagged on leads yet."
          />
        </ChartFrame>

        <ChartFrame
          icon={HeadphonesIcon}
          title="Call outcomes"
          subtitle="How conversations are ending"
        >
          {/* Reported here rather than page-wide: this panel failing says
              nothing about the KPI figures, which come from a different
              query. An empty list would claim there were no outcomes. */}
          {analytics.errors.outcomes ? (
            <Alert variant="destructive">
              <AlertTitle>This panel could not be loaded</AlertTitle>
              <AlertDescription>
                Everything else on this page is unaffected. The database said:
                <br />
                <code className="mt-1 inline-block">
                  {analytics.errors.outcomes}
                </code>
              </AlertDescription>
            </Alert>
          ) : (
            <CallOutcomes
              outcomes={analytics.callOutcomes}
              total={analytics.totalCalls.current}
            />
          )}
        </ChartFrame>
      </section>

      {cards ? <ActionCardRow cards={cards} /> : null}
    </>
  );
}

/**
 * Current state, not period totals — so it carries its own label rather than
 * inheriting the range in the page header. "3 overdue" filtered to the last 14
 * days would hide the oldest and most urgent items.
 */
function ActionCardRow({ cards }: { cards: DashboardActionCards }) {
  return (
    <section className="space-y-2.5">
      <SectionLabel as="h3">Needs attention · now</SectionLabel>
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
        <NavStatCard
          label="Leads"
          href="/leads"
          icon={<UsersIcon />}
          facts={[
            { text: `${cards.leads.total.toLocaleString()} total` },
            {
              text: `${cards.leads.needsAttention.toLocaleString()} need attention`,
              urgent: cards.leads.needsAttention > 0,
            },
          ]}
        />
        <NavStatCard
          label="Conversations"
          href="/conversations"
          icon={<MessagesSquareIcon />}
          facts={[{ text: "Calls, transcripts and recordings" }]}
        />
        <NavStatCard
          label="Follow-ups"
          href="/reminders"
          icon={<BellIcon />}
          facts={[
            { text: `${cards.reminders.dueToday.toLocaleString()} due today` },
            {
              text: `${cards.reminders.overdue.toLocaleString()} overdue`,
              urgent: cards.reminders.overdue > 0,
            },
          ]}
        />
      </div>
    </section>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function pctDelta(current: number, previous: number): number {
  if (previous === 0) {
    if (current === 0) return 0;
    return 100;
  }
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function rangeLabelFor(range: string): string {
  switch (range) {
    case "last_7_days":
      return "Last 7 days";
    case "last_30_days":
      return "Last 30 days";
    case "last_90_days":
      return "Last 90 days";
    case "last_180_days":
      return "Last 180 days";
    case "last_365_days":
      return "Last 365 days";
    case "all":
      return "All time";
    default:
      return range;
  }
}
