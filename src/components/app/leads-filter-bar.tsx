"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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

import type { LeadStatus } from "@/types/lead";

export type LeadFilters = {
  q?: string;
  intent?: "hot" | "warm" | "cold";
  pending?: "yes" | "no";
  status?: LeadStatus;
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
    // Filter changes invalidate the current page — drop back to page 1 so
    // users don't land on an empty paginated tail after narrowing results.
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
    filters.intent,
    filters.pending,
    filters.status,
  ].filter(Boolean).length;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-3 md:p-4">
      <div className="flex flex-wrap items-end gap-3">
        <FilterField htmlFor="leads-search" label="Search" className="min-w-56 flex-1">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="leads-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name, interest, or phone…"
              className="h-9 pl-8"
            />
          </div>
        </FilterField>

        {/*
          Status filter intentionally omitted from the UI — the Status column is
          hidden from the leads table per product direction (see docs/api.md
          § Leads). The query param is still honoured if present so deep links
          continue to work.
        */}

        <FilterField label="Intent" className="w-32">
          <FilterSelect
            value={filters.intent ?? "__any"}
            onChange={(v) => updateParam("intent", v)}
            options={INTENT_OPTIONS}
            ariaLabel="Intent"
          />
        </FilterField>

        <FilterField label="Pending action" className="w-36">
          <FilterSelect
            value={filters.pending ?? "__any"}
            onChange={(v) => updateParam("pending", v)}
            options={YES_NO_OPTIONS}
            ariaLabel="Pending action"
          />
        </FilterField>

        {activeCount > 0 ? (
          <Button variant="ghost" size="sm" onClick={clearAll} className="mb-0.5">
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
              {filters.pending ? (
                <Chip
                  label={`Pending · ${filters.pending === "yes" ? "Yes" : "No"}`}
                />
              ) : null}
              {filters.status ? (
                <Chip label={`Status · ${capitalise(filters.status)}`} />
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
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
  ariaLabel: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)}>
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

function Chip({ label }: { label: string }) {
  return <Badge variant="secondary">{label}</Badge>;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
