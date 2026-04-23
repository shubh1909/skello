"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type LeadFilters = {
  q?: string;
  intent?: "hot" | "warm" | "cold";
  contacted?: "yes" | "no";
  wants?: "yes" | "no";
  hasPhone?: "yes" | "no";
};

const INTENT_OPTIONS = [
  { value: "__any", label: "Any" },
  { value: "hot", label: "Hot" },
  { value: "warm", label: "Warm" },
  { value: "cold", label: "Cold" },
] as const;

const YES_NO_OPTIONS = [
  { value: "__any", label: "Any" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const;

export function LeadsFilterBar({
  filters,
  total,
}: {
  filters: LeadFilters;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const [q, setQ] = React.useState(filters.q ?? "");

  // Debounce the search text so we don't refetch on every keystroke.
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
    filters.intent,
    filters.contacted,
    filters.wants,
    filters.hasPhone,
  ].filter(Boolean).length;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-3 md:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, product, or phone…"
            className="h-9 pl-8"
          />
        </div>

        <FilterSelect
          value={filters.intent ?? "__any"}
          onChange={(v) => updateParam("intent", v)}
          options={INTENT_OPTIONS}
          width="w-36"
          label="Intent"
        />

        <FilterSelect
          value={filters.contacted ?? "__any"}
          onChange={(v) => updateParam("contacted", v)}
          options={YES_NO_OPTIONS}
          width="w-44"
          label="Contacted"
        />

        <FilterSelect
          value={filters.wants ?? "__any"}
          onChange={(v) => updateParam("wants", v)}
          options={YES_NO_OPTIONS}
          width="w-40"
          label="Wants WA"
        />

        <FilterSelect
          value={filters.hasPhone ?? "__any"}
          onChange={(v) => updateParam("hasPhone", v)}
          options={YES_NO_OPTIONS}
          width="w-36"
          label="Phone"
        />

        {activeCount > 0 ? (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            <XIcon /> Clear
          </Button>
        ) : null}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-1.5">
          {activeCount === 0 ? (
            <span>No filters applied.</span>
          ) : (
            <>
              <span>Filters:</span>
              {filters.q ? <Chip label={`"${filters.q}"`} /> : null}
              {filters.intent ? (
                <Chip label={`Intent · ${capitalise(filters.intent)}`} />
              ) : null}
              {filters.contacted ? (
                <Chip
                  label={`Contacted · ${filters.contacted === "yes" ? "Yes" : "No"}`}
                />
              ) : null}
              {filters.wants ? (
                <Chip
                  label={`Wants WA · ${filters.wants === "yes" ? "Yes" : "No"}`}
                />
              ) : null}
              {filters.hasPhone ? (
                <Chip
                  label={`Phone · ${filters.hasPhone === "yes" ? "Yes" : "No"}`}
                />
              ) : null}
            </>
          )}
        </div>
        <span>
          {pending ? "Updating…" : `${total} match${total === 1 ? "" : "es"}`}
        </span>
      </div>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  width,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
  width: string;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger className={width} aria-label={label}>
        <span className="text-xs font-medium text-muted-foreground">
          {label}:
        </span>
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

function Chip({ label }: { label: string }) {
  return <Badge variant="secondary">{label}</Badge>;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
