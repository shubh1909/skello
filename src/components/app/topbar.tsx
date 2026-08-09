import { Breadcrumbs } from "@/components/app/breadcrumbs";
import { CommandPalette } from "@/components/app/command-palette";
import { NotificationsBell } from "@/components/app/notifications-bell";
import { UserMenu } from "@/components/app/user-menu";
import { listReminders } from "@/actions/reminders";
import { getIsAdmin } from "@/lib/auth/admin";
import type { Reminder } from "@/types/reminder";

export async function Topbar({
  email,
  organisationId,
  orgSlug,
  leftSlot,
}: {
  email: string;
  organisationId: string;
  orgSlug: string;
  leftSlot?: React.ReactNode;
}) {
  const [reminders, isAdmin] = await Promise.all([
    fetchPendingReminders(organisationId),
    getIsAdmin(),
  ]);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/60 bg-background/80 px-4 backdrop-blur-xl md:px-6">
      {leftSlot}
      <Breadcrumbs />
      {/* The dead `<Input>` that used to sit here promised "Search leads,
          reminders, interests…" and had no handler, no state and no results.
          It is now the ⌘K palette trigger. */}
      <div className="ml-auto flex items-center md:ml-6 md:mr-auto md:w-full md:max-w-sm">
        <CommandPalette orgSlug={orgSlug} />
      </div>
      <div className="flex items-center gap-1.5">
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
