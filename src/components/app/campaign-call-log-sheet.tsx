"use client";

import * as React from "react";
import { PhoneIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getCampaignCalls,
  type CampaignCallRow,
} from "@/actions/campaigns";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CallStatus } from "@/types/call";

const STATUS_CLASS: Record<CallStatus, string> = {
  initiated: "bg-muted text-muted-foreground",
  ringing: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  in_progress:
    "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  completed:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  no_answer: "bg-muted text-foreground",
  busy: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  canceled: "bg-muted text-muted-foreground",
};

const STATUS_LABEL: Record<CallStatus, string> = {
  initiated: "Initiated",
  ringing: "Ringing",
  in_progress: "In progress",
  completed: "Completed",
  failed: "Failed",
  no_answer: "No answer",
  busy: "Busy",
  canceled: "Canceled",
};

function formatDuration(s: number | null): string {
  if (!s || s < 0) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return r === 0 ? `${m}m` : `${m}m ${r}s`;
}

interface CampaignCallLogSheetProps {
  campaignId: string | null;
  campaignName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CampaignCallLogSheet({
  campaignId,
  campaignName,
  open,
  onOpenChange,
}: CampaignCallLogSheetProps) {
  const [calls, setCalls] = React.useState<CampaignCallRow[] | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open || !campaignId) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    getCampaignCalls({ id: campaignId })
      .then((res) => {
        if (cancelled) return;
        if (!res.success) {
          toast.error(res.error);
          setCalls([]);
          return;
        }
        setCalls(res.data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, campaignId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Call log</SheetTitle>
          <SheetDescription>
            {campaignName ?? "Campaign"} · every dial across all attempts
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {loading ? (
            <CallLogSkeleton />
          ) : !calls || calls.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <span className="grid size-10 place-items-center rounded-full bg-muted">
                <PhoneIcon className="size-4 text-muted-foreground" />
              </span>
              <p className="text-sm font-medium">No calls yet</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Once the campaign starts dialing, every attempt will land here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {calls.map((c) => (
                <li key={c.id} className="grid gap-1 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {c.contact?.name ?? "—"}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {c.to_phone ?? c.contact?.phone ?? "—"}
                      </p>
                    </div>
                    <Badge className={cn("shrink-0", STATUS_CLASS[c.status])}>
                      {STATUS_LABEL[c.status]}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span suppressHydrationWarning>
                      {formatDateTime(c.started_at)}
                    </span>
                    <span>•</span>
                    <span>Attempt #{c.contact?.attempt ?? "?"}</span>
                    <span>•</span>
                    <span>{formatDuration(c.duration_seconds)}</span>
                    {c.recording_url ? (
                      <>
                        <span>•</span>
                        <a
                          href={c.recording_url}
                          target="_blank"
                          rel="noreferrer"
                          className="underline-offset-2 hover:underline"
                        >
                          Recording
                        </a>
                      </>
                    ) : null}
                  </div>
                  {c.error_message ? (
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-destructive">
                      {c.error_message}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CallLogSkeleton() {
  return (
    <ul className="divide-y divide-border/60">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="grid gap-2 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
          </div>
          <Skeleton className="h-3 w-3/4" />
        </li>
      ))}
    </ul>
  );
}
