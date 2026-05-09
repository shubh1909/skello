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

import type { CallDirection, CallStatus } from "@/types/call";

export type ConversationsFilters = {
  range: "24h" | "7d" | "30d" | "all";
  direction?: CallDirection;
  status?: CallStatus;
  agent?: string;
  q?: string;
};

const RANGE_OPTIONS = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All time" },
] as const;

const DIRECTION_OPTIONS = [
  { value: "__any", label: "All directions" },
  { value: "inbound", label: "Inbound" },
  { value: "outbound", label: "Outbound" },
] as const;

const STATUS_OPTIONS = [
  { value: "__any", label: "All outcomes" },
  { value: "completed", label: "Completed" },
  { value: "in_progress", label: "Live" },
  { value: "ringing", label: "Ringing" },
  { value: "initiated", label: "Dialling" },
  { value: "no_answer", label: "No answer" },
  { value: "busy", label: "Busy" },
  { value: "failed", label: "Failed" },
  { value: "canceled", label: "Canceled" },
] as const;

interface AgentOption {
  id: string;
  label: string;
}

export function ConversationsFilterBar({
  filters,
  agents,
}: {
  filters: ConversationsFilters;
  agents: AgentOption[];
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
    // Filter changes invalidate the current page — drop back to page 1.
    next.delete("page");
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  }

  function clearAll() {
    setQ("");
    startTransition(() => {
      router.replace(pathname, { scroll: false });
    });
  }

  const activeCount = [
    filters.q,
    filters.direction,
    filters.status,
    filters.agent,
    filters.range !== "7d" ? filters.range : null,
  ].filter(Boolean).length;

  const agentOptions = [
    { value: "__any", label: "All agents" },
    ...agents.map((a) => ({ value: a.id, label: a.label })),
  ];

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-3 md:p-4">
      <div className="flex flex-wrap items-end gap-3">
        <FilterField label="Range" className="w-44">
          <FilterSelect
            value={filters.range}
            onChange={(v) => updateParam("range", v)}
            options={RANGE_OPTIONS}
            ariaLabel="Range"
          />
        </FilterField>

        <FilterField label="Agent" className="w-44">
          <FilterSelect
            value={filters.agent ?? "__any"}
            onChange={(v) => updateParam("agent", v)}
            options={agentOptions}
            ariaLabel="Agent"
            disabled={agents.length === 0}
          />
        </FilterField>

        <FilterField label="Outcome" className="w-44">
          <FilterSelect
            value={filters.status ?? "__any"}
            onChange={(v) => updateParam("status", v)}
            options={STATUS_OPTIONS}
            ariaLabel="Outcome"
          />
        </FilterField>

        <FilterField label="Direction" className="w-44">
          <FilterSelect
            value={filters.direction ?? "__any"}
            onChange={(v) => updateParam("direction", v)}
            options={DIRECTION_OPTIONS}
            ariaLabel="Direction"
          />
        </FilterField>

        <FilterField
          htmlFor="conv-search"
          label="Search"
          className="ml-auto min-w-56 flex-1"
        >
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="conv-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Phone, call ID…"
              className="h-9 pl-8"
            />
          </div>
        </FilterField>

        {activeCount > 0 ? (
          <Button variant="ghost" size="sm" onClick={clearAll} className="mb-0.5">
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
