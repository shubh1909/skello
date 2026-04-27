import {
  ActivityIcon,
  CalendarIcon,
  ClockIcon,
  FlameIcon,
  HeadphonesIcon,
  PhoneIcon,
  TargetIcon,
  UsersIcon,
  ZapIcon,
} from "lucide-react";

import { CallOutcomes } from "@/components/app/analytics/call-outcomes";
import { ChartFrame } from "@/components/app/analytics/chart-frame";
import { DailyBarChart } from "@/components/app/analytics/daily-bar-chart";
import { HorizontalBarList } from "@/components/app/analytics/horizontal-bar-list";
import { RangeToggle } from "@/components/app/analytics/range-toggle";
import { StackedBarChart } from "@/components/app/analytics/stacked-bar-chart";
import { StatCard } from "@/components/app/stat-card";
import { VoiceAgentBanner } from "@/components/app/voice-agent-banner";
import { getBolnaIntegration } from "@/actions/bolna-integrations";
import {
  RANGE_LABEL,
  getDashboardAnalytics,
  parseRange,
} from "@/lib/analytics/dashboard";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Analytics · Skello" };

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const session = await requireSession();
  const sp = (await searchParams) ?? {};
  const rawRange = Array.isArray(sp.range) ? sp.range[0] : sp.range;
  const range = parseRange(rawRange);

  const [analytics, integrationResult] = await Promise.all([
    getDashboardAnalytics({
      orgSlug: session.organisation.slug,
      orgId: session.organisation.id,
      range,
    }),
    getBolnaIntegration(session.organisation.id),
  ]);
  const integration = integrationResult.success ? integrationResult.data : null;

  const callsDelta = pctDelta(
    analytics.totalCalls.current,
    analytics.totalCalls.previous,
  );
  const usersDelta = pctDelta(
    analytics.uniqueUsers.current,
    analytics.uniqueUsers.previous,
  );
  const durationDelta =
    analytics.avgDurationSec.current - analytics.avgDurationSec.previous;
  const qualifiedDelta =
    analytics.qualifiedRate.current - analytics.qualifiedRate.previous;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Analytics
          </p>
          <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            {greeting()}, {session.email.split("@")[0]}.
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {RANGE_LABEL[range]} · {session.organisation.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-card px-2.5 py-1.5 text-xs text-muted-foreground">
            <CalendarIcon className="size-3.5" />
            {RANGE_LABEL[range]}
          </span>
          <RangeToggle value={range} />
        </div>
      </header>

      <VoiceAgentBanner integration={integration} />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total calls"
          value={analytics.totalCalls.current.toLocaleString()}
          icon={<PhoneIcon />}
          trend={{
            delta: callsDelta,
            suffix: "%",
            period: "vs. previous period",
          }}
        />
        <StatCard
          label="Unique users"
          value={analytics.uniqueUsers.current.toLocaleString()}
          icon={<UsersIcon />}
          trend={{
            delta: usersDelta,
            suffix: "%",
            period: "vs. previous period",
          }}
        />
        <StatCard
          label="Avg. duration"
          value={formatDuration(analytics.avgDurationSec.current)}
          icon={<ClockIcon />}
          trend={{
            delta: durationDelta,
            suffix: "s",
            period: "vs. previous period",
          }}
        />
        <StatCard
          label="Qualified rate"
          value={`${analytics.qualifiedRate.current.toFixed(1)}%`}
          icon={<TargetIcon />}
          trend={{
            delta: Math.round(qualifiedDelta * 10) / 10,
            suffix: "pp",
            period: "vs. previous period",
          }}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartFrame
          icon={ActivityIcon}
          title="New Leads — Daily"
          subtitle={`${RANGE_LABEL[range]} · ${session.organisation.name}`}
          className="p-5 lg:col-span-2"
        >
          <DailyBarChart
            data={analytics.newLeadsDaily.map((d) => ({
              date: d.date,
              value: d.count,
            }))}
            seriesLabel="New Leads"
          />
        </ChartFrame>

        <ChartFrame
          icon={ZapIcon}
          title="Lead Interest"
          subtitle="What leads are asking about"
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
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartFrame
          icon={FlameIcon}
          title="Lead Temperature Distribution"
          subtitle={`Hot · Warm · Cold leads per day — ${RANGE_LABEL[range].toLowerCase()}`}
          className="p-5 lg:col-span-2"
        >
          <StackedBarChart
            data={analytics.leadTemperatureDaily}
            totals={analytics.leadTemperatureTotals}
          />
        </ChartFrame>

        <ChartFrame
          icon={HeadphonesIcon}
          title="Call Outcomes"
          subtitle="How calls are ending"
        >
          <CallOutcomes
            outcomes={analytics.callOutcomes}
            total={analytics.totalCalls.current}
          />
        </ChartFrame>
      </section>
    </div>
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

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
