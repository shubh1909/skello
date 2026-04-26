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

import type { LeadSource, LeadStatus } from "@/types/lead";

export type LeadFilters = {
  q?: string;
  intent?: "hot" | "warm" | "cold";
  contacted?: "yes" | "no";
  wants?: "yes" | "no";
  status?: LeadStatus;
  source?: LeadSource;
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

const STATUS_OPTIONS = [
  { value: "__any", label: "Any" },
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "negotiating", label: "Negotiating" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
] as const;

const SOURCE_OPTIONS = [
  { value: "__any", label: "Any" },
  { value: "inbound_call", label: "Inbound call" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "manual", label: "Manual" },
  { value: "web_form", label: "Web form" },
  { value: "import", label: "Import" },
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
    filters.status,
    filters.source,
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
              placeholder="Name, product, or phone…"
              className="h-9 pl-8"
            />
          </div>
        </FilterField>

        <FilterField label="Status" className="w-40">
          <FilterSelect
            value={filters.status ?? "__any"}
            onChange={(v) => updateParam("status", v)}
            options={STATUS_OPTIONS}
            ariaLabel="Status"
          />
        </FilterField>

        <FilterField label="Intent" className="w-32">
          <FilterSelect
            value={filters.intent ?? "__any"}
            onChange={(v) => updateParam("intent", v)}
            options={INTENT_OPTIONS}
            ariaLabel="Intent"
          />
        </FilterField>

        <FilterField label="Source" className="w-40">
          <FilterSelect
            value={filters.source ?? "__any"}
            onChange={(v) => updateParam("source", v)}
            options={SOURCE_OPTIONS}
            ariaLabel="Source"
          />
        </FilterField>

        <FilterField label="Contacted" className="w-32">
          <FilterSelect
            value={filters.contacted ?? "__any"}
            onChange={(v) => updateParam("contacted", v)}
            options={YES_NO_OPTIONS}
            ariaLabel="Contacted"
          />
        </FilterField>

        <FilterField label="Wants WhatsApp" className="w-40">
          <FilterSelect
            value={filters.wants ?? "__any"}
            onChange={(v) => updateParam("wants", v)}
            options={YES_NO_OPTIONS}
            ariaLabel="Wants WhatsApp"
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
              {filters.status ? (
                <Chip label={`Status · ${capitalise(filters.status)}`} />
              ) : null}
              {filters.source ? (
                <Chip label={`Source · ${sourceLabel(filters.source)}`} />
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

function sourceLabel(s: LeadSource): string {
  const match = SOURCE_OPTIONS.find((o) => o.value === s);
  return match?.label ?? s;
}
