"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, PlayIcon, SquareIcon } from "lucide-react";
import { toast } from "sonner";

import { setCodRunning } from "@/actions/cod-confirmation";
import { Button } from "@/components/ui/button";

interface Props {
  running: boolean;
  connected: boolean;
}

// Start / stop the always-on COD confirmation engine. Mirrors the recovery
// controls but with no channel/offer concerns — it's a single on/off switch.
export function CodConfirmationControls({ running, connected }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  function toggle(next: boolean) {
    startTransition(async () => {
      const res = await setCodRunning(next);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(next ? "COD confirmation is on" : "COD confirmation paused");
      router.refresh();
    });
  }

  if (running) {
    return (
      <Button
        variant="outline"
        onClick={() => toggle(false)}
        disabled={pending}
      >
        {pending ? <Loader2Icon className="animate-spin" /> : <SquareIcon />}
        Pause
      </Button>
    );
  }

  return (
    <Button onClick={() => toggle(true)} disabled={pending || !connected}>
      {pending ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
      Turn on
    </Button>
  );
}
