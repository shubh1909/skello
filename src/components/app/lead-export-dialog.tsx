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
import type { LeadActivityFilter } from "@/actions/lead-activity";

interface LeadExportDialogProps {
  // The leads table's live wire-format filter chips. Empty when no
  // filter is active; the dialog suppresses the scope chooser in that
  // case since "Filtered" and "All" would be identical.
  tableFilters?: LeadActivityFilter[];
  // The leads table's currently *applied* (not draft) search query.
  // Matched to filters: only present in the URL when a filter is on.
  tableSearch?: string;
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

export function LeadExportDialog({
  tableFilters,
  tableSearch,
}: LeadExportDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [range, setRange] = React.useState<ExportRangeValue>(
    DEFAULT_EXPORT_RANGE_VALUE,
  );
  const [scope, setScope] = React.useState<ExportScope | null>(null);
  const [counts, setCounts] = React.useState<CountState>(DEFAULT_COUNT_STATE);
  const [pending, setPending] = React.useState(false);

  const hasActiveFilters =
    (tableFilters && tableFilters.length > 0) ||
    Boolean(tableSearch && tableSearch.trim().length > 0);

  // Reset scope + counts when the dialog transitions to open. Lives in
  // the open handler (not a useEffect) per react-hooks/set-state-in-effect:
  // synchronous resets driven by user events should be in callbacks, not
  // mounted-effect bodies. The "Always ask" UX requires a deliberate pick
  // per export so the stale-state risk would silently bypass the choice.
  function handleOpenChange(next: boolean) {
    if (next && !open) {
      setScope(hasActiveFilters ? null : "all");
      setCounts(DEFAULT_COUNT_STATE);
    }
    setOpen(next);
  }

  // Debounced count fetch on open + on any param that affects the
  // returned set (date range, filters, search). 300ms covers the user
  // tabbing through "From"/"To" date inputs without firing per keystroke.
  React.useEffect(() => {
    if (!open) return;
    const resolved = resolveExportRange(range);
    if (resolved.error) {
      // Bad custom range — skip the fetch. Whatever count is currently on
      // screen lingers until the user corrects the dates and the effect
      // re-runs with a valid resolution.
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchCounts({
        from: resolved.from,
        to: resolved.to,
        tableFilters: hasActiveFilters ? tableFilters : undefined,
        tableSearch: hasActiveFilters ? tableSearch : undefined,
        signal: controller.signal,
      }).then((next) => {
        if (!controller.signal.aborted) setCounts(next);
      });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, range, tableFilters, tableSearch, hasActiveFilters]);

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
      if (scope === "filtered" && hasActiveFilters) {
        if (tableFilters && tableFilters.length > 0) {
          params.set("filters", JSON.stringify(tableFilters));
        }
        if (tableSearch && tableSearch.trim().length > 0) {
          params.set("search", tableSearch.trim());
        }
      }

      const res = await fetch(`/api/leads/export?${params.toString()}`, {
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
      const filename = match?.[1] ?? `skelo-leads-${range.preset}.csv`;

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
          `Exported ${(Number.isFinite(rows) ? rows : 0).toLocaleString()} leads.`,
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
          <DialogTitle>Export leads</DialogTitle>
          <DialogDescription>
            Download a filtered slice of your leads. Dates are based on when
            the lead was captured.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <ExportRangePicker
            value={range}
            onChange={setRange}
            disabled={pending}
            idPrefix="leads-export"
          />

          {hasActiveFilters ? (
            <ExportScopeChooser
              value={scope}
              onChange={setScope}
              filteredCount={counts.filtered}
              totalCount={counts.all}
              cap={counts.cap}
              noun="leads"
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
  tableFilters: LeadActivityFilter[] | undefined;
  tableSearch: string | undefined;
  signal: AbortSignal;
}

async function fetchCounts(args: FetchCountsArgs): Promise<CountState> {
  // Two parallel requests: one with the table's filters/search applied,
  // one without. When the dialog is invoked without active filters we
  // skip the filtered request — both numbers would match.
  const baseParams = new URLSearchParams();
  if (args.from) baseParams.set("from", args.from);
  if (args.to) baseParams.set("to", args.to);

  const filteredParams = new URLSearchParams(baseParams);
  if (args.tableFilters && args.tableFilters.length > 0) {
    filteredParams.set("filters", JSON.stringify(args.tableFilters));
  }
  if (args.tableSearch && args.tableSearch.trim().length > 0) {
    filteredParams.set("search", args.tableSearch.trim());
  }

  const filteredApplied =
    Boolean(args.tableFilters?.length) ||
    Boolean(args.tableSearch?.trim().length);

  try {
    const requests: Promise<Response>[] = [
      fetch(`/api/leads/export/count?${baseParams.toString()}`, {
        signal: args.signal,
      }),
    ];
    if (filteredApplied) {
      requests.push(
        fetch(`/api/leads/export/count?${filteredParams.toString()}`, {
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
      // Superseded by a newer fetch — preserve current display.
      return DEFAULT_COUNT_STATE;
    }
    return DEFAULT_COUNT_STATE;
  }
}
