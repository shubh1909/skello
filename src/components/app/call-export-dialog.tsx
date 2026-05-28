"use client";

import * as React from "react";
import { DownloadIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import {
  type ExportScope,
  ExportScopeChooser,
} from "@/components/app/export-scope-chooser";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DEFAULT_EXPORT_RANGE_VALUE,
  ExportRangePicker,
  type ExportRangeValue,
  resolveExportRange,
} from "@/components/app/export-range-picker";
import type { CallDirection, CallStatus } from "@/types/call";

// Date-free filter set. The dialog owns the date dimension via its own
// range picker; including `from`/`to` here would double-apply once with
// the conversations page's range filter and again with the dialog's.
export interface ConversationsExportFilters {
  direction?: CallDirection;
  status?: CallStatus;
  agent_id?: string;
  q?: string;
  lead_id?: string;
}

interface CallExportDialogProps {
  tableFilters?: ConversationsExportFilters;
}

interface CountState {
  filtered: number | null;
  all: number | null;
  cap: number;
}

const DEFAULT_COUNT_STATE: CountState = {
  filtered: null,
  all: null,
  cap: 10_000,
};

function hasAnyFilter(f: ConversationsExportFilters | undefined): boolean {
  if (!f) return false;
  return Boolean(
    f.direction || f.status || f.agent_id || f.q?.trim() || f.lead_id,
  );
}

export function CallExportDialog({ tableFilters }: CallExportDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [range, setRange] = React.useState<ExportRangeValue>({
    ...DEFAULT_EXPORT_RANGE_VALUE,
    preset: "last_7_days",
  });
  const [scope, setScope] = React.useState<ExportScope | null>(null);
  const [counts, setCounts] = React.useState<CountState>(DEFAULT_COUNT_STATE);
  const [pending, setPending] = React.useState(false);

  const hasActiveFilters = hasAnyFilter(tableFilters);

  // Reset scope + counts when the dialog transitions to open. Lives in
  // the open handler (not a useEffect) per react-hooks/set-state-in-effect.
  function handleOpenChange(next: boolean) {
    if (next && !open) {
      setScope(hasActiveFilters ? null : "all");
      setCounts(DEFAULT_COUNT_STATE);
    }
    setOpen(next);
  }

  React.useEffect(() => {
    if (!open) return;
    const resolved = resolveExportRange(range);
    if (resolved.error) {
      // Bad custom range — skip the fetch; the previous count lingers
      // until the user corrects the dates.
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchCounts({
        from: resolved.from,
        to: resolved.to,
        tableFilters: hasActiveFilters ? tableFilters : undefined,
        signal: controller.signal,
      }).then((next) => {
        if (!controller.signal.aborted) setCounts(next);
      });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, range, tableFilters, hasActiveFilters]);

  async function onExport() {
    if (hasActiveFilters && scope === null) {
      toast.error("Choose what to export first.");
      return;
    }
    const resolved = resolveExportRange(range);
    if (resolved.error) {
      toast.error(resolved.error);
      return;
    }
    setPending(true);
    try {
      const params = new URLSearchParams();
      params.set("range", range.preset);
      if (resolved.from) params.set("from", resolved.from);
      if (resolved.to) params.set("to", resolved.to);
      if (scope === "filtered" && tableFilters) {
        if (tableFilters.direction) params.set("direction", tableFilters.direction);
        if (tableFilters.status) params.set("status", tableFilters.status);
        if (tableFilters.agent_id) params.set("agent_id", tableFilters.agent_id);
        if (tableFilters.q?.trim()) params.set("q", tableFilters.q.trim());
        if (tableFilters.lead_id) params.set("lead_id", tableFilters.lead_id);
      }

      const res = await fetch(`/api/calls/export?${params.toString()}`, {
        method: "GET",
      });
      if (!res.ok) {
        const msg = await res
          .json()
          .then((j) => j.error as string)
          .catch(() => `Export failed (${res.status})`);
        toast.error(msg);
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") ?? "";
      const match = /filename="?([^"]+)"?/.exec(cd);
      const filename = match?.[1] ?? `skelo-calls-${range.preset}.csv`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      const rows = Number.parseInt(res.headers.get("x-export-rows") ?? "", 10);
      const truncated = res.headers.get("x-export-truncated") === "true";
      const cap = Number.parseInt(res.headers.get("x-export-cap") ?? "", 10);
      if (truncated && Number.isFinite(cap)) {
        toast.warning(
          `Exported ${cap.toLocaleString()} rows — filter still has more matches.`,
        );
      } else {
        toast.success(
          `Exported ${(Number.isFinite(rows) ? rows : 0).toLocaleString()} calls.`,
        );
      }
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline">
            <DownloadIcon /> Export
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export calls</DialogTitle>
          <DialogDescription>
            Download a filtered slice of your conversations. Dates are based on
            when the call started. Audio links are not included.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <ExportRangePicker
            value={range}
            onChange={setRange}
            disabled={pending}
            idPrefix="calls-export"
          />

          {hasActiveFilters ? (
            <ExportScopeChooser
              value={scope}
              onChange={setScope}
              filteredCount={counts.filtered}
              totalCount={counts.all}
              cap={counts.cap}
              noun="calls"
              disabled={pending}
            />
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" type="button" disabled={pending} />
            }
          >
            Cancel
          </DialogClose>
          <Button
            type="button"
            onClick={onExport}
            disabled={pending || (hasActiveFilters && scope === null)}
          >
            {pending ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <DownloadIcon />
            )}
            {pending ? "Preparing…" : "Download CSV"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface FetchCountsArgs {
  from: string | null;
  to: string | null;
  tableFilters: ConversationsExportFilters | undefined;
  signal: AbortSignal;
}

async function fetchCounts(args: FetchCountsArgs): Promise<CountState> {
  const baseParams = new URLSearchParams();
  if (args.from) baseParams.set("from", args.from);
  if (args.to) baseParams.set("to", args.to);

  const filteredParams = new URLSearchParams(baseParams);
  const f = args.tableFilters;
  if (f) {
    if (f.direction) filteredParams.set("direction", f.direction);
    if (f.status) filteredParams.set("status", f.status);
    if (f.agent_id) filteredParams.set("agent_id", f.agent_id);
    if (f.q?.trim()) filteredParams.set("q", f.q.trim());
    if (f.lead_id) filteredParams.set("lead_id", f.lead_id);
  }
  const filteredApplied = hasAnyFilter(f);

  try {
    const requests: Promise<Response>[] = [
      fetch(`/api/calls/export/count?${baseParams.toString()}`, {
        signal: args.signal,
      }),
    ];
    if (filteredApplied) {
      requests.push(
        fetch(`/api/calls/export/count?${filteredParams.toString()}`, {
          signal: args.signal,
        }),
      );
    }
    const [allRes, filteredRes] = await Promise.all(requests);
    const allJson = (await allRes.json()) as { count: number; cap: number };
    const filteredJson = filteredRes
      ? ((await filteredRes.json()) as { count: number; cap: number })
      : null;
    return {
      filtered: filteredJson?.count ?? allJson.count,
      all: allJson.count,
      cap: allJson.cap,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return DEFAULT_COUNT_STATE;
    }
    return DEFAULT_COUNT_STATE;
  }
}
