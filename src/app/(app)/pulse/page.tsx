import Link from "next/link";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckIcon,
  ClockIcon,
  FlameIcon,
  PhoneIcon,
  UsersIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LeadCreateDialog } from "@/components/app/lead-create-dialog";
import { ReminderDialog } from "@/components/app/reminder-dialog";
import { VoiceAgentBanner } from "@/components/app/voice-agent-banner";
import { getBolnaIntegration } from "@/actions/bolna-integrations";
import { listCalls } from "@/actions/calls";
import { listLeads } from "@/actions/leads";
import { listReminders } from "@/actions/reminders";
import { requireSession } from "@/lib/auth/session";
import { formatRelative, initialsOf, renderNow } from "@/lib/format";
import type { CallStatus } from "@/types/call";
import type { LeadIntent } from "@/types/lead";

export const metadata = { title: "Pulse · Skelo" };

const INTENT_VARIANT: Record<
  LeadIntent,
  "destructive" | "secondary" | "outline"
> = {
  hot: "destructive",
  warm: "secondary",
  cold: "outline",
};

const INTENT_LABEL: Record<LeadIntent, string> = {
  hot: "Hot",
  warm: "Warm",
  cold: "Cold",
};

const CALL_STATUS_LABEL: Record<CallStatus, string> = {
  initiated: "Dialling",
  ringing: "Ringing",
  in_progress: "Live",
  completed: "Completed",
  failed: "Failed",
  no_answer: "No answer",
  busy: "Busy",
  canceled: "Canceled",
};

const CALL_STATUS_VARIANT: Record<
  CallStatus,
  "secondary" | "destructive" | "outline" | "default"
> = {
  initiated: "default",
  ringing: "default",
  in_progress: "default",
  completed: "secondary",
  failed: "destructive",
  no_answer: "outline",
  busy: "outline",
  canceled: "outline",
};

export default async function PulsePage() {
  const session = await requireSession();
  const orgId = session.organisation.id;
  const orgSlug = session.organisation.slug;

  const [leadsResult, remindersResult, callsResult, integrationResult] =
    await Promise.all([
      listLeads({ org_slug: orgSlug, limit: 20, offset: 0 }),
      listReminders({
        organisation_id: orgId,
        status: "pending",
        limit: 10,
        offset: 0,
      }),
      listCalls({ organisation_id: orgId, limit: 10, offset: 0 }),
      getBolnaIntegration(orgId),
    ]);

  const leads = leadsResult.success ? leadsResult.data.items : [];
  const reminders = remindersResult.success ? remindersResult.data.items : [];
  const calls = callsResult.success ? callsResult.data.items : [];
  const integration = integrationResult.success ? integrationResult.data : null;

  const now = renderNow();
  const dayMs = 24 * 60 * 60 * 1000;

  const needsAttention = leads
    .filter(
      (l) =>
        l.lead_intent === "hot" &&
        l.pending_action &&
        new Date(l.created_at).getTime() >= now - 3 * dayMs,
    )
    .slice(0, 5);

  const overdueReminders = reminders.filter(
    (r) => new Date(r.remind_at).getTime() < now,
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Pulse
          </p>
          <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            {greeting()}, {session.email.split("@")[0]}.
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Live snapshot of what&apos;s moving across {session.organisation.name}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ReminderDialog
            organisationId={orgId}
            trigger={
              <Button variant="outline">
                <ClockIcon /> New reminder
              </Button>
            }
          />
          <LeadCreateDialog orgSlug={orgSlug} />
        </div>
      </header>

      <VoiceAgentBanner integration={integration} />

      {needsAttention.length > 0 ? (
        <Card className="gap-3 border-amber-500/30 bg-amber-500/5 p-5">
          <div className="flex items-center gap-2">
            <AlertTriangleIcon className="size-4 text-amber-600 dark:text-amber-400" />
            <CardTitle className="text-amber-900 dark:text-amber-200">
              Needs your attention
            </CardTitle>
            <Badge variant="secondary" className="ml-auto">
              {needsAttention.length} hot · uncontacted
            </Badge>
          </div>
          <ul className="divide-y divide-amber-500/10">
            {needsAttention.map((lead) => (
              <li
                key={lead.id}
                className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <span className="grid size-8 place-items-center rounded-full bg-amber-500/15 text-[11px] font-medium text-amber-900 dark:text-amber-200">
                  {initialsOf(lead.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {lead.name ?? "Unnamed"}
                    </span>
                    <Badge variant="destructive">
                      <FlameIcon /> Hot
                    </Badge>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {lead.interest ?? "No interest tagged"} ·{" "}
                    {lead.phone ?? "no phone"} ·{" "}
                    {formatRelative(lead.created_at, now)}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  render={<Link href={`/leads?q=${encodeURIComponent(lead.phone ?? lead.name ?? "")}`} />}
                >
                  Open
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 p-0">
          <CardHeader className="flex-row items-center justify-between border-b px-5 py-4">
            <div className="flex items-center gap-2">
              <UsersIcon className="size-4 text-muted-foreground" />
              <CardTitle>Recent leads</CardTitle>
            </div>
            <Button
              size="sm"
              variant="ghost"
              render={<Link href="/leads" />}
            >
              View all <ArrowRightIcon />
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {leads.length === 0 ? (
              <EmptyBlock
                title="No leads yet"
                hint="Add your first lead to get started."
              />
            ) : (
              <ul className="divide-y divide-border/60">
                {leads.slice(0, 8).map((lead) => {
                  const intent = lead.lead_intent ?? "cold";
                  const isPending = Boolean(lead.pending_action);
                  return (
                    <li
                      key={lead.id}
                      className="flex items-center gap-3 px-5 py-3"
                    >
                      <span className="grid size-8 place-items-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
                        {initialsOf(lead.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {lead.name ?? "Unnamed"}
                          </span>
                          <Badge variant={INTENT_VARIANT[intent]}>
                            {INTENT_LABEL[intent]}
                          </Badge>
                          {!isPending ? (
                            <Badge variant="secondary">
                              <CheckIcon /> Done
                            </Badge>
                          ) : null}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {lead.interest ?? "—"} · {lead.phone ?? "no phone"}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatRelative(lead.created_at, now)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="p-0">
          <CardHeader className="flex-row items-center justify-between border-b px-5 py-4">
            <div className="flex items-center gap-2">
              <ClockIcon className="size-4 text-muted-foreground" />
              <CardTitle>Upcoming</CardTitle>
            </div>
            {overdueReminders > 0 ? (
              <Badge variant="destructive">{overdueReminders} overdue</Badge>
            ) : null}
          </CardHeader>
          <CardContent className="p-0">
            {reminders.length === 0 ? (
              <EmptyBlock
                title="All clear"
                hint="No reminders scheduled."
              />
            ) : (
              <ul className="divide-y divide-border/60">
                {reminders.slice(0, 8).map((r) => {
                  const overdue = new Date(r.remind_at).getTime() < now;
                  return (
                    <li key={r.id} className="px-5 py-3">
                      <p className="truncate text-sm font-medium">{r.title}</p>
                      <p
                        className={
                          overdue
                            ? "text-xs font-medium text-destructive"
                            : "text-xs text-muted-foreground"
                        }
                      >
                        {overdue ? "Overdue · " : ""}
                        {formatRelative(r.remind_at, now)} · {r.type}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-6">
        <Card className="p-0">
          <CardHeader className="flex-row items-center justify-between border-b px-5 py-4">
            <div className="flex items-center gap-2">
              <PhoneIcon className="size-4 text-muted-foreground" />
              <CardTitle>Recent calls</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {calls.length === 0 ? (
              <EmptyBlock
                title="No calls yet"
                hint="Outbound calls triggered from a lead will land here."
              />
            ) : (
              <ul className="divide-y divide-border/60">
                {calls.slice(0, 8).map((c) => {
                  const duration =
                    typeof c.duration_seconds === "number"
                      ? formatDuration(c.duration_seconds)
                      : null;
                  return (
                    <li
                      key={c.id}
                      className="flex items-center gap-3 px-5 py-3"
                    >
                      <span className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground">
                        <PhoneIcon className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">
                          Call to{" "}
                          <span className="font-mono tabular-nums">
                            {c.to_phone}
                          </span>
                          {duration ? (
                            <span className="text-muted-foreground">
                              {" · "}
                              {duration}
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatRelative(c.started_at, now)}
                          {c.error_message ? ` · ${c.error_message}` : ""}
                        </p>
                      </div>
                      <Badge variant={CALL_STATUS_VARIANT[c.status]}>
                        {CALL_STATUS_LABEL[c.status]}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function EmptyBlock({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}
