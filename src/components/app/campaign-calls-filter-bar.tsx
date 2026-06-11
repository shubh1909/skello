"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OutcomeFilterOption } from "@/actions/campaigns";
import type { CallStatus } from "@/types/call";

// Filter set for the campaign detail Calls tab. Mirrors the wire params the
// table forwards to listConversations (status / call_outcome / q).
export interface CampaignCallsFilters {
  status?: CallStatus;
  outcome?: string;
  q?: string;
}

const STATUS_OPTIONS = [
  { value: "__any", label: "All statuses" },
  { value: "completed", label: "Completed" },
  { value: "in_progress", label: "Live" },
  { value: "ringing", label: "Ringing" },
  { value: "initiated", label: "Dialling" },
  { value: "no_answer", label: "No answer" },
  { value: "busy", label: "Busy" },
  { value: "failed", label: "Failed" },
  { value: "canceled", label: "Canceled" },
] as const;

export function CampaignCallsFilterBar({
  filters,
  outcomeOptions,
}: {
  filters: CampaignCallsFilters;
  outcomeOptions: OutcomeFilterOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const [q, setQ] = React.useState(filters.q ?? "");

  React.useEffect(() => {
    const current = filters.q ?? "";
    if (q === current) return;
    const t = setTimeout(() => updateParam("q", q || null), 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === null || value === "" || value === "__any") {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    // Always keep the Calls tab active — these filters only apply there.
    next.set("tab", "calls");
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  }

  function clearAll() {
    setQ("");
    startTransition(() => {
      // Preserve the tab, drop every filter param.
      router.replace(`${pathname}?tab=calls`, { scroll: false });
    });
  }

  const activeCount = [filters.q, filters.status, filters.outcome].filter(
    Boolean,
  ).length;

  const outcomeSelectOptions = [
    { value: "__any", label: "All outcomes" },
    ...outcomeOptions.map((o) => ({ value: o.key, label: o.label })),
  ];

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-3 md:p-4">
      <div className="flex flex-wrap items-end gap-3">
        <FilterField label="Status" className="w-44">
          <FilterSelect
            value={filters.status ?? "__any"}
            onChange={(v) => updateParam("status", v)}
            options={STATUS_OPTIONS}
            ariaLabel="Status"
          />
        </FilterField>

        <FilterField label="Outcome" className="w-48">
          <FilterSelect
            value={filters.outcome ?? "__any"}
            onChange={(v) => updateParam("outcome", v)}
            options={outcomeSelectOptions}
            ariaLabel="Call outcome"
            disabled={outcomeOptions.length === 0}
          />
        </FilterField>

        <FilterField
          htmlFor="campaign-calls-search"
          label="Number"
          className="ml-auto min-w-56 flex-1"
        >
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="campaign-calls-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Phone or call ID…"
              className="h-9 pl-8"
            />
          </div>
        </FilterField>

        {activeCount > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="mb-0.5"
          >
            <XIcon /> Clear
          </Button>
        ) : null}
      </div>

      <div className="flex items-center justify-end text-xs text-muted-foreground">
        <span>{pending ? "Updating…" : null}</span>
      </div>
    </div>
  );
}

function FilterField({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <Label
        htmlFor={htmlFor}
        className="text-xs font-medium text-muted-foreground"
      >
        {label}
      </Label>
      {children}
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  ariaLabel,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => v && onChange(v)}
      disabled={disabled}
    >
      <SelectTrigger className="w-full" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
