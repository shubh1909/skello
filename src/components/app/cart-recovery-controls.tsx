"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  DownloadIcon,
  Loader2Icon,
  PlayIcon,
  SquareIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  exportRecoveryAttempts,
  setRecoveryRunning,
} from "@/actions/shopify-recovery";
import { Button } from "@/components/ui/button";

interface Props {
  running: boolean;
  // Whether the org has any prior recovery activity — picks Start vs Resume.
  hasHistory: boolean;
  connected: boolean;
}

export function CartRecoveryControls({ running, hasHistory, connected }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [exporting, setExporting] = React.useState(false);

  function toggle(next: boolean) {
    startTransition(async () => {
      const res = await setRecoveryRunning(next);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(
        next ? "Cart recovery is running" : "Cart recovery stopped",
      );
      router.refresh();
    });
  }

  function onExport() {
    setExporting(true);
    startTransition(async () => {
      const res = await exportRecoveryAttempts();
      setExporting(false);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      // Stream the CSV to a download without a round trip to storage.
      const blob = new Blob([res.data.csv], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.data.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {running ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => toggle(false)}
          disabled={pending}
          className="gap-1.5"
        >
          {pending ? (
            <Loader2Icon className="animate-spin" />
          ) : (
            <SquareIcon />
          )}
          Stop
        </Button>
      ) : (
        <Button
          type="button"
          onClick={() => toggle(true)}
          disabled={pending || !connected}
          className="gap-1.5"
        >
          {pending ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
          {hasHistory ? "Resume" : "Start"}
        </Button>
      )}

      <Button
        type="button"
        variant="outline"
        onClick={onExport}
        disabled={pending}
        className="gap-1.5"
      >
        {exporting ? (
          <Loader2Icon className="animate-spin" />
        ) : (
          <DownloadIcon />
        )}
        Export
      </Button>
    </div>
  );
}
