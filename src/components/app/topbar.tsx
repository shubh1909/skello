import { SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { NotificationsBell } from "@/components/app/notifications-bell";
import { UserMenu } from "@/components/app/user-menu";
import { listReminders } from "@/actions/reminders";
import { getIsAdmin } from "@/lib/auth/admin";
import type { Reminder } from "@/types/reminder";

export async function Topbar({
  email,
  organisationId,
}: {
  email: string;
  organisationId: string;
}) {
  const [reminders, isAdmin] = await Promise.all([
    fetchPendingReminders(organisationId),
    getIsAdmin(),
  ]);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/60 bg-background/80 px-4 backdrop-blur-xl md:px-6">
      <div className="relative hidden w-full max-w-sm md:block">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search leads, reminders, interests…"
          className="h-9 pl-8"
        />
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <NotificationsBell
          reminders={reminders}
          organisationId={organisationId}
        />
        <UserMenu email={email} isAdmin={isAdmin} />
      </div>
    </header>
  );
}

async function fetchPendingReminders(
  organisationId: string,
): Promise<Reminder[]> {
  const result = await listReminders({
    organisation_id: organisationId,
    status: "pending",
    limit: 25,
    offset: 0,
  });
  return result.success ? result.data.items : [];
}
