"use client";

import * as React from "react";
import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BellIcon,
  CalendarIcon,
  CheckIcon,
  MailIcon,
  MessageCircleIcon,
  PhoneIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { ReminderDialog } from "@/components/app/reminder-dialog";
import { markReminderDone } from "@/actions/reminders";
import { formatRelative } from "@/lib/format";
import { useClientNow } from "@/hooks/use-client-now";
import type { Reminder, ReminderType } from "@/types/reminder";

const TYPE_ICON: Record<ReminderType, typeof CalendarIcon> = {
  call: PhoneIcon,
  whatsapp: MessageCircleIcon,
  email: MailIcon,
  visit: CalendarIcon,
  other: CalendarIcon,
};

export function NotificationsBell({
  reminders,
  organisationId,
}: {
  reminders: Reminder[];
  organisationId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const now = useClientNow();

  const dueCount = useMemo(() => {
    if (now === null) return 0;
    return reminders.filter((r) => new Date(r.remind_at).getTime() <= now)
      .length;
  }, [reminders, now]);

  function onMarkDone(id: string) {
    startTransition(async () => {
      const result = await markReminderDone(id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Reminder completed");
      router.refresh();
    });
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative"
            aria-label="Reminders"
          />
        }
      >
        <BellIcon />
        {dueCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-destructive text-[9px] font-semibold text-destructive-foreground ring-2 ring-background">
            {dueCount > 9 ? "9+" : dueCount}
          </span>
        ) : reminders.length > 0 ? (
          <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[360px] gap-0 p-0"
        sideOffset={8}
      >
        <div className="flex items-center justify-between px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="font-medium">Reminders</span>
            {dueCount > 0 ? (
              <Badge variant="destructive">{dueCount} due</Badge>
            ) : null}
          </div>
          <ReminderDialog
            organisationId={organisationId}
            trigger={
              <Button variant="ghost" size="xs">
                New
              </Button>
            }
          />
        </div>
        <Separator />
        <div className="max-h-[360px] overflow-y-auto">
          {reminders.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1 px-4 py-10 text-center">
              <span className="grid size-9 place-items-center rounded-full bg-muted">
                <BellIcon className="size-4 text-muted-foreground" />
              </span>
              <p className="text-sm font-medium">All clear</p>
              <p className="text-xs text-muted-foreground">
                No pending reminders. Schedule one to follow up.
              </p>
            </div>
          ) : (
            <ul>
              {reminders.map((r) => {
                const Icon = TYPE_ICON[r.type] ?? CalendarIcon;
                const overdue =
                  now !== null && new Date(r.remind_at).getTime() < now;
                return (
                  <li
                    key={r.id}
                    className="group flex items-start gap-2.5 px-3 py-2.5 hover:bg-muted/60"
                  >
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-muted">
                      <Icon className="size-3.5 text-muted-foreground" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.title}</p>
                      <p className="line-clamp-1 text-xs text-muted-foreground">
                        {r.notes ?? "No notes"}
                      </p>
                      <p
                        className={
                          overdue
                            ? "mt-0.5 text-[11px] font-medium text-destructive"
                            : "mt-0.5 text-[11px] text-muted-foreground"
                        }
                        suppressHydrationWarning
                      >
                        {now === null
                          ? ""
                          : `${overdue ? "Overdue · " : ""}${formatRelative(
                              r.remind_at,
                              now,
                            )}`}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label="Mark done"
                      disabled={pending}
                      onClick={() => onMarkDone(r.id)}
                    >
                      <CheckIcon />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <Separator />
        <div className="flex items-center justify-between px-3 py-2 text-xs">
          <a
            href="/reminders"
            className="text-muted-foreground hover:text-foreground"
          >
            View all reminders
          </a>
          <span className="text-muted-foreground">
            {reminders.length} pending
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
