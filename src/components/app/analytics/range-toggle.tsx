"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

const OPTIONS = ["24h", "7d", "14d", "30d"] as const;

export function RangeToggle({ value }: { value: (typeof OPTIONS)[number] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  function onPick(next: (typeof OPTIONS)[number]) {
    if (next === value) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", next);
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div
      role="group"
      aria-label="Time range"
      className="inline-flex items-center rounded-lg border border-border/70 bg-card p-0.5 text-xs"
    >
      {OPTIONS.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onPick(opt)}
            aria-pressed={active}
            disabled={pending}
            className={cn(
              "min-w-10 rounded-md px-2.5 py-1.5 font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
