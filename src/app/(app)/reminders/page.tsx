import { ClockIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ReminderDialog } from "@/components/app/reminder-dialog";
import { RemindersList } from "@/components/app/reminders-list";
import { listReminders } from "@/actions/reminders";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Reminders · Skello" };

interface PageProps {
  searchParams?: Promise<{ status?: string }>;
}

export default async function RemindersPage({ searchParams }: PageProps) {
  const session = await requireSession();
  const sp = (await searchParams) ?? {};
  const status =
    sp.status === "done" || sp.status === "dismissed" ? sp.status : "pending";

  const result = await listReminders({
    organisation_id: session.organisation.id,
    limit: 100,
    offset: 0,
    status,
  });

  const items = result.success ? result.data.items : [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1.5">
          <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            Reminders
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {items.length} {status} · scoped to {session.organisation.name}
          </p>
        </div>
        <ReminderDialog
          organisationId={session.organisation.id}
          trigger={
            <Button>
              <ClockIcon /> New reminder
            </Button>
          }
        />
      </header>

      <nav className="flex items-center gap-1 text-sm">
        <FilterTab href="/reminders?status=pending" active={status === "pending"} label="Pending" />
        <FilterTab href="/reminders?status=done" active={status === "done"} label="Done" />
        <FilterTab href="/reminders?status=dismissed" active={status === "dismissed"} label="Dismissed" />
      </nav>

      {!result.success ? (
        <Card className="border-destructive/40 p-6 text-sm text-destructive">
          {result.error}
        </Card>
      ) : (
        <RemindersList reminders={items} />
      )}
    </div>
  );
}

function FilterTab({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <a
      href={href}
      className={
        active
          ? "rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background"
          : "rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
      }
    >
      {label}
    </a>
  );
}
