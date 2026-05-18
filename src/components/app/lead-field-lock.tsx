"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ClockIcon, LockIcon, UnlockIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  listLeadFieldOverrides,
  setLeadFieldOverride,
  unlockLeadFieldOverride,
} from "@/actions/lead-field-overrides";
import { formatDateTime } from "@/lib/format";
import type { LeadFieldOverride } from "@/types/lead-field-override";

interface Props {
  leadId: string;
  fieldPath: string;
  // Current value on the lead — used to pre-fill the "set/lock" flow and to
  // detect if the lock is "active" (most recent event is a set on this path).
  value: unknown;
}

// Inline lock icon next to a lead field. Click to open the history drawer.
// The icon's visual state reflects whether the field is currently locked:
//   - Filled lock + accent colour: locked. Webhooks won't overwrite this value.
//   - Outline lock + muted: never locked, or last action was unlock.
//
// Both states reveal full history when clicked.
export function LeadFieldLock({ leadId, fieldPath, value }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [history, setHistory] = React.useState<LeadFieldOverride[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  // The locked-or-not state is derived from history. Until we've fetched it,
  // render the icon in a neutral state to avoid a flicker.
  const locked = React.useMemo(() => {
    if (!history) return null;
    const forPath = history.filter((h) => h.field_path === fieldPath);
    if (forPath.length === 0) return false;
    return forPath[0]?.action === "set"; // newest first; see ORDER BY in action
  }, [history, fieldPath]);

  async function refresh() {
    setLoading(true);
    const res = await listLeadFieldOverrides({ lead_id: leadId, limit: 100 });
    setLoading(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    setHistory(res.data);
  }

  function onOpen(next: boolean) {
    setOpen(next);
    if (next && !history) void refresh();
  }

  function onLock() {
    startTransition(async () => {
      const res = await setLeadFieldOverride({
        lead_id: leadId,
        field_path: fieldPath,
        value,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Field locked — voice agent won't overwrite it");
      await refresh();
      router.refresh();
    });
  }

  function onUnlock() {
    startTransition(async () => {
      const res = await unlockLeadFieldOverride({
        lead_id: leadId,
        field_path: fieldPath,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Field unlocked — voice agent updates resumed");
      await refresh();
      router.refresh();
    });
  }

  const Icon = locked === true ? LockIcon : UnlockIcon;

  return (
    <>
      <button
        type="button"
        onClick={() => onOpen(true)}
        className={
          locked === true
            ? "ml-0.5 inline-flex items-center text-amber-600 transition-colors hover:text-amber-700 dark:text-amber-400"
            : "ml-0.5 inline-flex items-center text-muted-foreground/40 transition-colors hover:text-muted-foreground"
        }
        title={
          locked === true
            ? "Locked — voice agent won't change this. Click to view history or unlock."
            : "Click to view edit history or lock this field"
        }
        aria-label="Field edit history and lock"
      >
        <Icon className="size-3" />
      </button>

      <Sheet open={open} onOpenChange={onOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-sm">
          <SheetHeader className="gap-2 border-b border-border/60 p-5">
            <SheetTitle className="text-base">Field history</SheetTitle>
            <SheetDescription className="text-xs">
              <span className="font-mono">{fieldPath}</span>
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 p-5">
            <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                {locked === true ? (
                  <>
                    <LockIcon className="size-3.5 text-amber-600 dark:text-amber-400" />
                    <span className="font-medium">Locked</span>
                  </>
                ) : (
                  <>
                    <UnlockIcon className="size-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Unlocked</span>
                  </>
                )}
              </div>
              {locked === true ? (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={onUnlock}
                  disabled={pending}
                >
                  <UnlockIcon /> Unlock
                </Button>
              ) : (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={onLock}
                  disabled={pending}
                >
                  <LockIcon /> Lock current value
                </Button>
              )}
            </div>

            {loading && history === null ? (
              <div className="space-y-2">
                <div className="h-8 animate-pulse rounded-md bg-muted/60" />
                <div className="h-8 animate-pulse rounded-md bg-muted/40" />
              </div>
            ) : history && history.filter((h) => h.field_path === fieldPath).length > 0 ? (
              <ol className="space-y-2">
                {history
                  .filter((h) => h.field_path === fieldPath)
                  .map((row) => (
                    <li
                      key={row.id}
                      className="rounded-md border border-border/60 bg-card px-3 py-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Badge
                          variant={row.action === "set" ? "secondary" : "outline"}
                        >
                          {row.action === "set" ? "Locked" : "Unlocked"}
                        </Badge>
                        <span
                          className="flex items-center gap-1 text-muted-foreground"
                          suppressHydrationWarning
                        >
                          <ClockIcon className="size-3" />
                          {formatDateTime(row.edited_at)}
                        </span>
                      </div>
                      {row.action === "set" ? (
                        <div className="mt-2 space-y-1">
                          <ValueRow label="From" value={row.previous_value} />
                          <ValueRow label="To" value={row.value} />
                        </div>
                      ) : null}
                      {row.reason ? (
                        <p className="mt-2 text-[11px] italic text-muted-foreground">
                          “{row.reason}”
                        </p>
                      ) : null}
                    </li>
                  ))}
              </ol>
            ) : (
              <p className="rounded-md border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
                No edits yet. Lock the current value to prevent the voice
                agent from overwriting it.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function ValueRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-10 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-[11px]">{formatValue(value)}</span>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
