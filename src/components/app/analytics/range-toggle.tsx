"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

// Keyed by the value the URL carries; the label is what the button shows.
// "all" needs a word rather than a duration — "∞" and "0d" both read as bugs.
const OPTIONS = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "14d", label: "14d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All" },
] as const;

type RangeValue = (typeof OPTIONS)[number]["value"];

export function RangeToggle({ value }: { value: RangeValue }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  function onPick(next: RangeValue) {
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
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onPick(opt.value)}
            aria-pressed={active}
            disabled={pending}
            className={cn(
              "min-w-10 rounded-md px-2.5 py-1.5 font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
