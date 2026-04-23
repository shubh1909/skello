import Link from "next/link";
import { ArrowRightIcon, ClockIcon, FlameIcon, UsersIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LeadCreateDialog } from "@/components/app/lead-create-dialog";
import { ReminderDialog } from "@/components/app/reminder-dialog";
import { StatCard } from "@/components/app/stat-card";
import { listLeads } from "@/actions/leads";
import { listReminders } from "@/actions/reminders";
import { requireSession } from "@/lib/auth/session";
import { formatRelative, initialsOf, renderNow } from "@/lib/format";

export const metadata = { title: "Dashboard · Skello" };

export default async function DashboardPage() {
  const session = await requireSession();
  const orgSlug = session.organisation.slug;
  const orgId = session.organisation.id;

  const [leadsResult, remindersResult] = await Promise.all([
    listLeads({ org_slug: orgSlug, limit: 10, offset: 0 }),
    listReminders({
      organisation_id: orgId,
      status: "pending",
      limit: 10,
      offset: 0,
    }),
  ]);

  const leads = leadsResult.success ? leadsResult.data.items : [];
  const totalLeads = leadsResult.success ? leadsResult.data.total : 0;
  const reminders = remindersResult.success ? remindersResult.data.items : [];

  const now = renderNow();
  const hot = leads.filter((l) => l.lead_intent === "hot").length;
  const contacted = leads.filter((l) => l.contacted_on_watsapp).length;
  const dueToday = reminders.filter((r) => {
    const t = new Date(r.remind_at).getTime();
    const day = 24 * 60 * 60 * 1000;
    return t <= now + day;
  }).length;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Workspace
          </p>
          <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            {greeting()}, {session.email.split("@")[0]}.
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Here&apos;s what&apos;s happening across {session.organisation.name}.
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

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total leads"
          value={totalLeads}
          hint="All-time captured"
        />
        <StatCard
          label="Hot pipeline"
          value={hot}
          hint="From last 10 captured"
        />
        <StatCard
          label="WhatsApp contacted"
          value={contacted}
          hint={`${leads.length ? Math.round((contacted / leads.length) * 100) : 0}% of recent`}
        />
        <StatCard
          label="Reminders due ≤24h"
          value={dueToday}
          hint={`${reminders.length} pending total`}
        />
      </section>

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
              <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
                <p className="font-medium">No leads yet</p>
                <p className="text-sm text-muted-foreground">
                  Add your first lead to get started.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {leads.slice(0, 6).map((lead) => (
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
                        {lead.lead_intent === "hot" ? (
                          <Badge variant="destructive">
                            <FlameIcon /> Hot
                          </Badge>
                        ) : null}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {lead.product ?? "—"} · {lead.phone ?? "no phone"}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatRelative(lead.created_at)}
                    </div>
                  </li>
                ))}
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
            <Button size="sm" variant="ghost" render={<Link href="/reminders" />}>
              All <ArrowRightIcon />
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {reminders.length === 0 ? (
              <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
                <p className="font-medium">All clear</p>
                <p className="text-sm text-muted-foreground">
                  No reminders scheduled.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {reminders.slice(0, 6).map((r) => {
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
                        {formatRelative(r.remind_at)} · {r.type}
                      </p>
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

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
