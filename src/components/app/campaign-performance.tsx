import {
  ActivityIcon,
  ClockIcon,
  PhoneCallIcon,
  PhoneIcon,
  PhoneOutgoingIcon,
  TargetIcon,
  TrendingUpIcon,
  TriangleAlertIcon,
  UsersIcon,
} from "lucide-react";

import { CallOutcomes } from "@/components/app/analytics/call-outcomes";
import { ChartFrame } from "@/components/app/analytics/chart-frame";
import { LineChart } from "@/components/app/analytics/line-chart";
import { StatCard } from "@/components/app/stat-card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CampaignStats, ContactState } from "@/actions/campaigns";

// Visual language for each contact lifecycle state. Order here also drives the
// summary strip (actionable states first).
const CONTACT_STATE_META: Array<{
  key: ContactState;
  label: string;
  badge: string;
}> = [
  {
    key: "deferred",
    label: "Deferred",
    badge:
      "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  },
  {
    key: "callback",
    label: "Callback",
    badge:
      "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  },
  {
    key: "retry",
    label: "Retrying",
    badge:
      "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  },
  {
    key: "dialing",
    label: "Dialing",
    badge: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  },
  {
    key: "queued",
    label: "Queued",
    badge: "bg-muted text-muted-foreground",
  },
  {
    key: "failed",
    label: "Failed",
    badge: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  },
  {
    key: "succeeded",
    label: "Succeeded",
    badge:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
];

const CONTACT_STATE_LABEL = Object.fromEntries(
  CONTACT_STATE_META.map((m) => [m.key, m]),
) as Record<ContactState, (typeof CONTACT_STATE_META)[number]>;

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
  // States present in this campaign, in actionable order, for the summary strip.
  const presentStates = CONTACT_STATE_META.filter(
    (m) => stats.contactStateCounts[m.key] > 0,
  );
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

      {/* Degraded warning — every judged number is resting, so the dispatcher
          is dialing from the least-bad number (operator's completion-first
          choice). Non-blocking, but worth surfacing. */}
      {stats.degraded ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3.5 text-sm">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="leading-relaxed">
            <span className="font-medium">Running on degraded numbers.</span>{" "}
            Every caller ID is below the {stats.switchFloorPct}% connect-rate
            floor over the last {stats.switchWindowMinutes} min, so calls are
            going out on the least-bad number. Add fresh numbers to recover
            answer rates.
          </p>
        </div>
      ) : null}

      {/* Per-contact state — answers "why hasn't this contact been called?".
          Each pending contact is broken out into deferred / callback / retry /
          queued so a slow-looking run is self-explanatory. */}
      {stats.contacts.length > 0 ? (
        <ChartFrame
          icon={UsersIcon}
          title="Contacts"
          subtitle="Where each contact sits — and why it's waiting"
          className="p-5"
        >
          {/* Summary strip: count per state. */}
          <div className="mb-4 flex flex-wrap gap-2">
            {presentStates.map((m) => (
              <Badge key={m.key} className={cn("gap-1.5", m.badge)}>
                {m.label}
                <span className="tabular-nums">
                  {stats.contactStateCounts[m.key].toLocaleString()}
                </span>
              </Badge>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border/60 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Contact</th>
                  <th className="py-2 px-3 font-medium">State</th>
                  <th className="py-2 px-3 font-medium">Reason</th>
                  <th className="py-2 px-3 text-right font-medium">Attempts</th>
                  <th className="py-2 pl-3 text-right font-medium">
                    Next attempt
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {stats.contacts.map((c) => {
                  const meta = CONTACT_STATE_LABEL[c.state];
                  return (
                    <tr key={c.id} className="align-middle">
                      <td className="py-2.5 pr-3">
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {c.name?.trim() || "—"}
                          </span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {c.phone}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge className={meta.badge}>{meta.label}</Badge>
                      </td>
                      <td className="py-2.5 px-3 text-muted-foreground">
                        {c.detail}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums">
                        {c.attempt}/{c.maxAttempts}
                      </td>
                      <td className="py-2.5 pl-3 text-right tabular-nums text-muted-foreground">
                        {c.nextAttemptLabel ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {stats.contactsOverflow > 0 ? (
            <p className="mt-3 text-[11px] text-muted-foreground">
              Showing the {stats.contacts.length} most actionable contacts.{" "}
              {stats.contactsOverflow.toLocaleString()} more not shown — counts
              above cover all contacts.
            </p>
          ) : null}
        </ChartFrame>
      ) : null}

      {/* Per caller-ID breakdown — how switching spread the load + each
          number's recent connect-rate health. Only shown once dials exist. */}
      {stats.byNumber.length > 0 ? (
        <ChartFrame
          icon={PhoneIcon}
          title="Caller IDs"
          subtitle={`Connect-rate switching · floor ${stats.switchFloorPct}% over ${stats.switchWindowMinutes}m`}
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
                  <th className="py-2 pl-3 text-right font-medium">
                    Recent ({stats.switchWindowMinutes}m)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {stats.byNumber.map((n) => (
                  <tr key={n.phone} className="align-middle">
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col">
                          <span className="font-medium">{n.label}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {n.phone}
                          </span>
                        </div>
                        {n.isResting ? (
                          <Badge
                            variant="secondary"
                            className="text-[10px] text-amber-700 dark:text-amber-400"
                          >
                            resting
                          </Badge>
                        ) : null}
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
                    <td
                      className={cn(
                        "py-2.5 pl-3 text-right tabular-nums",
                        n.isResting
                          ? "font-medium text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground",
                      )}
                    >
                      {n.recentConnectRatePct === null
                        ? "—"
                        : `${n.recentConnectRatePct}%`}
                    </td>
                  </tr>
                ))}
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
