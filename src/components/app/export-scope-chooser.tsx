"use client";

import * as React from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { AlertTriangleIcon, FilterIcon, LayersIcon, Loader2Icon } from "lucide-react";

import { cn } from "@/lib/utils";

export type ExportScope = "filtered" | "all";

interface Props {
  value: ExportScope | null;
  onChange: (scope: ExportScope) => void;
  // null = still loading the count, number = resolved
  filteredCount: number | null;
  totalCount: number | null;
  cap: number;
  // Noun for screen-reader labels and the "N {noun}" copy ("leads" / "calls")
  noun: string;
  disabled?: boolean;
}

// Shared scope chooser for both export dialogs. Renders a two-row radio
// list — "Filtered view" vs "All in range" — with the live row count
// inline on each option, plus an inline cap warning when the count exceeds
// what the route will actually export.
//
// Why a forced choice (no default selection): users were running exports
// without realising their active filters didn't apply and pulling the
// whole org. The "Always ask" UX answer mandates a deliberate pick before
// Download enables.
export function ExportScopeChooser({
  value,
  onChange,
  filteredCount,
  totalCount,
  cap,
  noun,
  disabled,
}: Props) {
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">What should we export?</span>
      <RadioGroup
        // Always pass a string — Base UI treats `undefined` as
        // uncontrolled, and switching to a string when the user picks
        // triggers the "uncontrolled to controlled" warning. The empty
        // string is our "nothing picked yet" sentinel and matches no
        // option's value.
        value={value ?? ""}
        onValueChange={(v) => {
          if (v === "filtered" || v === "all") onChange(v);
        }}
        disabled={disabled}
        className="grid gap-2"
      >
        <ScopeOption
          value="filtered"
          title="Filtered view"
          subtitle={`Matches your active filters${value === "filtered" ? "" : ""}`}
          count={filteredCount}
          cap={cap}
          noun={noun}
          icon={<FilterIcon className="size-4" />}
          selected={value === "filtered"}
        />
        <ScopeOption
          value="all"
          title="All in range"
          subtitle="Ignore filters · everything within the date range"
          count={totalCount}
          cap={cap}
          noun={noun}
          icon={<LayersIcon className="size-4" />}
          selected={value === "all"}
        />
      </RadioGroup>
    </div>
  );
}

function ScopeOption({
  value,
  title,
  subtitle,
  count,
  cap,
  noun,
  icon,
  selected,
}: {
  value: ExportScope;
  title: string;
  subtitle: string;
  count: number | null;
  cap: number;
  noun: string;
  icon: React.ReactNode;
  selected: boolean;
}) {
  const overCap = count !== null && count > cap;
  return (
    <Radio.Root
      value={value}
      className={cn(
        "group flex w-full cursor-pointer items-start gap-3 rounded-md border bg-card px-3 py-2.5 text-left transition-colors",
        "hover:bg-muted/40",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "data-disabled:cursor-not-allowed data-disabled:opacity-60",
        selected ? "border-foreground/40 bg-muted/30" : "border-border",
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border transition-colors",
          selected ? "border-foreground bg-foreground" : "border-border bg-background",
        )}
      >
        <Radio.Indicator className="size-1.5 rounded-full bg-background data-unchecked:hidden" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <span className="text-muted-foreground">{icon}</span>
          {title}
          <span className="ml-auto inline-flex items-center gap-1 font-mono text-xs tabular-nums text-muted-foreground">
            {count === null ? (
              <Loader2Icon className="size-3 animate-spin" />
            ) : (
              <>
                {count.toLocaleString()} {noun}
              </>
            )}
          </span>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {subtitle}
        </p>
        {overCap ? (
          <p className="mt-1.5 inline-flex items-start gap-1.5 rounded-sm bg-amber-50 px-1.5 py-1 text-xs leading-snug text-amber-900 dark:bg-amber-500/10 dark:text-amber-300">
            <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" />
            <span>
              Over the {cap.toLocaleString()}-row export cap — only the most
              recent {cap.toLocaleString()} {noun} will be downloaded.
            </span>
          </p>
        ) : null}
      </div>
    </Radio.Root>
  );
}
