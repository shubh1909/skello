"use client";

import * as React from "react";
import { DownloadIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ExportRange = "today" | "yesterday" | "last_week" | "last_month" | "all";
type ExportFormat = "csv";

const RANGE_OPTIONS: { value: ExportRange; label: string; hint: string }[] = [
  { value: "today", label: "Today", hint: "Last 24 hours" },
  { value: "yesterday", label: "Yesterday", hint: "24–48 hours ago" },
  { value: "last_week", label: "Last week", hint: "Last 7 days" },
  { value: "last_month", label: "Last month", hint: "Last 30 days" },
  { value: "all", label: "All time", hint: "Every lead" },
];

const FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: "csv", label: "CSV (.csv)" },
];

export function LeadExportDialog() {
  const [open, setOpen] = React.useState(false);
  const [range, setRange] = React.useState<ExportRange>("last_month");
  const [format, setFormat] = React.useState<ExportFormat>("csv");
  const [pending, setPending] = React.useState(false);

  async function onExport() {
    setPending(true);
    try {
      const res = await fetch(
        `/api/leads/export?range=${encodeURIComponent(range)}`,
        { method: "GET" },
      );
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
      const filename = match?.[1] ?? `skello-leads-${range}.csv`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success("Export ready — check your downloads.");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
          <div className="grid gap-1.5">
            <Label htmlFor="export-range">Duration</Label>
            <Select
              value={range}
              onValueChange={(v) => setRange(v as ExportRange)}
              disabled={pending}
            >
              <SelectTrigger id="export-range" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <div className="flex flex-col">
                      <span>{o.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {o.hint}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="export-format">Format</Label>
            <Select
              value={format}
              onValueChange={(v) => setFormat(v as ExportFormat)}
              disabled={pending}
            >
              <SelectTrigger id="export-format" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMAT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" type="button" disabled={pending} />
            }
          >
            Cancel
          </DialogClose>
          <Button type="button" onClick={onExport} disabled={pending}>
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
