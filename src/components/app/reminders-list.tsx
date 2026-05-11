"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CalendarIcon,
  CheckIcon,
  MailIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  PhoneIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InfiniteScrollFooter } from "@/components/app/infinite-scroll-footer";
import {
  deleteReminder,
  listReminders,
  markReminderDone,
  markReminderPending,
} from "@/actions/reminders";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useClientNow } from "@/hooks/use-client-now";
import { useInfiniteList } from "@/hooks/use-infinite-list";
import type { Reminder, ReminderStatus, ReminderType } from "@/types/reminder";

const TYPE_ICON: Record<ReminderType, typeof CalendarIcon> = {
  call: PhoneIcon,
  whatsapp: MessageCircleIcon,
  email: MailIcon,
  visit: CalendarIcon,
  other: CalendarIcon,
};

const TYPE_LABEL: Record<ReminderType, string> = {
  call: "Call",
  whatsapp: "WhatsApp",
  email: "Email",
  visit: "Visit",
  other: "Other",
};

interface RemindersListProps {
  reminders: Reminder[];
  total: number;
  pageSize: number;
  organisationId: string;
  status: ReminderStatus;
}

export function RemindersList({
  reminders,
  total,
  pageSize,
  organisationId,
  status,
}: RemindersListProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const now = useClientNow();

  const fetchPage = React.useCallback(
    async (offset: number, limit: number) => {
      const res = await listReminders({
        organisation_id: organisationId,
        limit,
        offset,
        status,
      });
      if (!res.success) {
        toast.error(res.error);
        return null;
      }
      return res.data;
    },
    [organisationId, status],
  );

  const {
    items,
    total: liveTotal,
    loading,
    hasMore,
    sentinelRef,
  } = useInfiniteList<Reminder>({
    initialItems: reminders,
    initialTotal: total,
    pageSize,
    fetchPage,
  });

  function run(fn: () => Promise<{ success: boolean; error?: string } | unknown>, msg: string) {
    startTransition(async () => {
      const result = (await fn()) as { success: boolean; error?: string };
      if (!result.success) {
        toast.error(result.error ?? "Something went wrong");
        return;
      }
      toast.success(msg);
      router.refresh();
    });
  }

  if (items.length === 0) {
    return (
      <Card className="items-center gap-2 py-16 text-center">
        <span className="grid size-10 place-items-center rounded-full bg-muted">
          <CalendarIcon className="size-4 text-muted-foreground" />
        </span>
        <p className="font-medium">No reminders</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Schedule a follow-up from a lead row, or use the button above to add
          one.
        </p>
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden p-0">
        <ul className="divide-y divide-border/60">
          {items.map((r) => {
          const Icon = TYPE_ICON[r.type] ?? CalendarIcon;
          const overdue =
            r.status === "pending" &&
            now !== null &&
            new Date(r.remind_at).getTime() < now;
          return (
            <li
              key={r.id}
              className="flex items-start gap-3 px-4 py-3 md:px-5"
            >
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-muted">
                <Icon className="size-4 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{r.title}</span>
                  {r.status === "done" ? (
                    <Badge variant="secondary">
                      <CheckIcon /> Done
                    </Badge>
                  ) : overdue ? (
                    <Badge variant="destructive">Overdue</Badge>
                  ) : (
                    <Badge variant="outline">Pending</Badge>
                  )}
                  <Badge variant="ghost" className="text-muted-foreground">
                    {TYPE_LABEL[r.type]}
                  </Badge>
                </div>
                {r.notes ? (
                  <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                    {r.notes}
                  </p>
                ) : null}
                <p
                  className="mt-1 text-xs text-muted-foreground"
                  suppressHydrationWarning
                >
                  {now === null
                    ? ""
                    : `${formatDateTime(r.remind_at)} · ${formatRelative(
                        r.remind_at,
                        now,
                      )}`}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {r.status === "pending" ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Mark done"
                    onClick={() =>
                      run(() => markReminderDone(r.id), "Reminder completed")
                    }
                    disabled={pending}
                  >
                    <CheckIcon />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Reopen"
                    onClick={() =>
                      run(() => markReminderPending(r.id), "Reminder reopened")
                    }
                    disabled={pending}
                  >
                    <RotateCcwIcon />
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="More"
                      />
                    }
                  >
                    <MoreHorizontalIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {r.status === "pending" ? (
                      <DropdownMenuItem
                        onClick={() =>
                          run(() => markReminderDone(r.id), "Reminder completed")
                        }
                      >
                        <CheckIcon /> Mark done
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        onClick={() =>
                          run(
                            () => markReminderPending(r.id),
                            "Reminder reopened",
                          )
                        }
                      >
                        <RotateCcwIcon /> Reopen
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() =>
                        run(() => deleteReminder(r.id), "Reminder removed")
                      }
                    >
                      <Trash2Icon /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          );
        })}
        </ul>
      </Card>

      <InfiniteScrollFooter
        loading={loading}
        hasMore={hasMore}
        loadedCount={items.length}
        total={liveTotal}
        sentinelRef={sentinelRef}
      />
    </>
  );
}
