import {
  ActivityIcon,
  ClockIcon,
  PhoneCallIcon,
  PhoneIcon,
  PhoneOutgoingIcon,
  TargetIcon,
  TrendingUpIcon,
  UsersIcon,
} from "lucide-react";

import { CallOutcomes } from "@/components/app/analytics/call-outcomes";
import { ChartFrame } from "@/components/app/analytics/chart-frame";
import { LineChart } from "@/components/app/analytics/line-chart";
import { StatCard } from "@/components/app/stat-card";
import { cn } from "@/lib/utils";
import type { CampaignStats } from "@/actions/campaigns";

// Performance dashboard for a single campaign. Pure presentation — the page
// fetches CampaignStats server-side and hands it down. Mirrors the visual
// language of the main analytics dashboard (StatCards + ChartFrame).

function formatDuration(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds < 0) return "0:00";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function CampaignPerformance({ stats }: { stats: CampaignStats }) {
  const funnel: Array<{ label: string; value: number; hint: string }> = [
    {
      label: "Contacts",
      value: stats.totalContacts,
      hint: "In the uploaded list",
    },
    {
      label: "Attempted",
      value: stats.attemptedContacts,
      hint: "Dialed at least once",
    },
    {
      label: "Connected",
      value: stats.connectedContacts,
      hint: "Conversation happened",
    },
    {
      label: "Succeeded",
      value: stats.succeededContacts,
      hint: "Marked successful",
    },
  ];
  const funnelMax = Math.max(stats.totalContacts, 1);

  return (
    <div className="flex flex-col gap-5">
      {/* Headline rates */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Connect rate"
          value={`${stats.connectRatePct}%`}
          icon={<TargetIcon />}
          hint="Connected ÷ attempted"
        />
        <StatCard
          label="Success rate"
          value={`${stats.successRatePct}%`}
          icon={<TrendingUpIcon />}
          hint="Succeeded ÷ total contacts"
        />
        <StatCard
          label="Total dials"
          value={stats.totalCalls.toLocaleString()}
          icon={<PhoneOutgoingIcon />}
          hint="Across all attempts"
        />
        <StatCard
          label="Avg attempts"
          value={stats.avgAttemptsPerContact.toString()}
          icon={<ActivityIcon />}
          hint="Per contact"
        />
      </section>

      {/* Funnel + outcomes */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartFrame icon={UsersIcon} title="Funnel" subtitle="Contacts down the pipeline">
          <ul className="flex flex-col gap-2.5">
            {funnel.map((step) => {
              const pct = Math.round((step.value / funnelMax) * 100);
              return (
                <li key={step.label} className="grid gap-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{step.label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {step.value.toLocaleString()}
                      <span className="ml-1">({pct}%)</span>
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-linear-to-r from-primary/70 to-primary"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {step.hint}
                  </span>
                </li>
              );
            })}
          </ul>
        </ChartFrame>

        <ChartFrame
          icon={PhoneCallIcon}
          title="Call outcomes"
          subtitle="Every dial, all attempts"
        >
          <CallOutcomes outcomes={stats.outcomes} total={stats.totalCalls} />
        </ChartFrame>
      </section>

      {/* Talk time */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          label="Total talk time"
          value={formatDuration(stats.totalTalkSeconds)}
          icon={<ClockIcon />}
          hint="Connected calls only"
        />
        <StatCard
          label="Avg call length"
          value={formatDuration(stats.avgTalkSeconds)}
          icon={<ClockIcon />}
          hint="Per connected call"
        />
        <StatCard
          label="Longest call"
          value={formatDuration(stats.longestTalkSeconds)}
          icon={<ClockIcon />}
          hint="Single connected call"
        />
      </section>

      {/* Per caller-ID breakdown — how rotation spread the load + which
          numbers connect best. Only shown once dials exist. */}
      {stats.byNumber.length > 0 ? (
        <ChartFrame
          icon={PhoneIcon}
          title="Caller IDs"
          subtitle={`Rotation spread · cap ${stats.dailyCap}/number/day`}
          className="p-5"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border/60 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Number</th>
                  <th className="py-2 px-3 text-right font-medium">Dials</th>
                  <th className="py-2 px-3 text-right font-medium">Connected</th>
                  <th className="py-2 px-3 text-right font-medium">
                    Connect rate
                  </th>
                  <th className="py-2 pl-3 text-right font-medium">Today</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {stats.byNumber.map((n) => {
                  const capPct = Math.min(
                    100,
                    Math.round((n.callsToday / stats.dailyCap) * 100),
                  );
                  const nearCap = n.callsToday >= stats.dailyCap * 0.8;
                  return (
                    <tr key={n.phone} className="align-middle">
                      <td className="py-2.5 pr-3">
                        <div className="flex flex-col">
                          <span className="font-medium">{n.label}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {n.phone}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums">
                        {n.totalCalls.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums">
                        {n.connected.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums">
                        {n.connectRatePct}%
                      </td>
                      <td className="py-2.5 pl-3 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <span
                            className={cn(
                              "text-xs tabular-nums",
                              nearCap
                                ? "font-medium text-amber-600 dark:text-amber-400"
                                : "text-muted-foreground",
                            )}
                          >
                            {n.callsToday} / {stats.dailyCap}
                          </span>
                          <span className="h-1 w-20 overflow-hidden rounded-full bg-muted">
                            <span
                              className={cn(
                                "block h-full rounded-full",
                                nearCap ? "bg-amber-500" : "bg-emerald-500/70",
                              )}
                              style={{ width: `${capPct}%` }}
                            />
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ChartFrame>
      ) : null}

      {/* Pacing — a line reads better than bars for a continuous run. */}
      <ChartFrame
        icon={TrendingUpIcon}
        title="Dials over time"
        subtitle="Calls placed per day"
        className="p-5"
      >
        <LineChart
          data={stats.callsPerDay.map((d) => ({
            period: d.date,
            value: d.count,
          }))}
          seriesLabel="Dials"
          emptyLabel="No dials placed yet."
        />
      </ChartFrame>
    </div>
  );
}
