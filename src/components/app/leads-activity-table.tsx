"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  BellPlusIcon,
  CheckIcon,
  PhoneIcon,
  PhoneIncomingIcon,
  PhoneOutgoingIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InfiniteScrollFooter } from "@/components/app/infinite-scroll-footer";
import { LeadDetailSheet } from "@/components/app/lead-detail-sheet";
import { ReminderDialog } from "@/components/app/reminder-dialog";
import { WhatsAppDialog } from "@/components/app/whatsapp-dialog";
import { WhatsAppIcon } from "@/components/brand/whatsapp-icon";
import { deleteLead, toggleLeadPendingAction } from "@/actions/leads";
import { initiateCall } from "@/actions/calls";
import {
  type LeadActivityFilter,
  listLeadsWithCallActivity,
  type LeadWithCallActivity,
} from "@/actions/lead-activity";
import { formatDateTime, formatRelative, initialsOf } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useClientNow } from "@/hooks/use-client-now";
import { useCallsRealtime } from "@/hooks/use-calls-realtime";
import { useInfiniteList } from "@/hooks/use-infinite-list";
import { useLeadsRealtime } from "@/hooks/use-leads-realtime";
import type { Lead, LeadIntent } from "@/types/lead";
import type { LeadFieldDefinition } from "@/types/lead-field-definition";

const INTENT_CLASSES: Record<LeadIntent, string> = {
  hot: "border-transparent bg-destructive/10 text-destructive dark:bg-destructive/20",
  warm: "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300",
  cold: "border-transparent bg-primary text-primary-foreground",
};

const INTENT_LABEL: Record<LeadIntent, string> = {
  hot: "Hot",
  warm: "Warm",
  cold: "Cold",
};

// Read a dynamic field's value from the lead row based on the catalog's
// (source_column, category, key_path). Returns the raw value or null.
function readDynamicValue(lead: Lead, def: LeadFieldDefinition): unknown {
  const blob =
    def.source_column === "lead_data"
      ? lead.lead_data
      : lead.custom_data?.[def.category ?? ""];
  if (!blob) return null;
  const value = (blob as Record<string, unknown>)[def.key_path];
  return value ?? null;
}

function renderDynamicValue(value: unknown, type: LeadFieldDefinition["data_type"]): React.ReactNode {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  if (type === "boolean") {
    const truthy =
      value === true ||
      (typeof value === "string" && ["true", "yes", "1"].includes(value.toLowerCase()));
    return truthy ? "Yes" : "No";
  }
  if (type === "date") {
    const iso = typeof value === "string" ? value : null;
    if (!iso) return String(value);
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return <span suppressHydrationWarning>{formatDateTime(iso)}</span>;
  }
  if (type === "number") {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n.toLocaleString() : String(value);
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

interface DynamicFilterValue {
  source: LeadActivityFilter["source"];
  category: string;
  key: string;
  op: LeadActivityFilter["op"];
  value: string;
  // Carry type + label so the chip renders the right label and we can
  // cast number/date input correctly when posting to the server.
  type: LeadFieldDefinition["data_type"];
  label: string;
}

function filterToWire(f: DynamicFilterValue): LeadActivityFilter | null {
  if (f.value === "" || f.value === undefined) return null;
  let typed: string | number | boolean = f.value;
  if (f.type === "number") {
    const n = Number(f.value);
    if (!Number.isFinite(n)) return null;
    typed = n;
  } else if (f.type === "boolean") {
    typed = f.value.toLowerCase() === "true";
  }
  return {
    source: f.source,
    category: f.category || undefined,
    key: f.key,
    op: f.op,
    value: typed,
  };
}

interface LeadsActivityTableProps {
  rows: LeadWithCallActivity[];
  total: number;
  pageSize: number;
  organisationId: string;
  orgSlug: string;
  includeZeroCalls: boolean;
  dynamicColumns: LeadFieldDefinition[];
  initialSearch?: string;
}

export function LeadsActivityTable({
  rows,
  total,
  pageSize,
  organisationId,
  orgSlug,
  includeZeroCalls,
  dynamicColumns,
  initialSearch = "",
}: LeadsActivityTableProps) {
  const router = useRouter();
  const now = useClientNow();

  const [search, setSearch] = React.useState(initialSearch);
  const [appliedSearch, setAppliedSearch] = React.useState(initialSearch);
  const [filters, setFilters] = React.useState<DynamicFilterValue[]>([]);

  const filterableDefs = React.useMemo(
    () => dynamicColumns.filter((d) => d.filterable),
    [dynamicColumns],
  );

  const wireFilters = React.useMemo(
    () =>
      filters
        .map(filterToWire)
        .filter((f): f is LeadActivityFilter => f !== null),
    [filters],
  );

  const fetchPage = React.useCallback(
    async (offset: number, limit: number) => {
      const res = await listLeadsWithCallActivity({
        org_slug: orgSlug,
        include_zero_calls: includeZeroCalls,
        limit,
        offset,
        filters: wireFilters,
        search: appliedSearch || undefined,
      });
      if (!res.success) {
        toast.error(res.error);
        return null;
      }
      return res.data;
    },
    [orgSlug, includeZeroCalls, wireFilters, appliedSearch],
  );

  const {
    items,
    total: liveTotal,
    loading,
    hasMore,
    pagedBeyondInitial,
    sentinelRef,
  } = useInfiniteList<LeadWithCallActivity>({
    initialItems: rows,
    initialTotal: total,
    pageSize,
    fetchPage,
  });

  useLeadsRealtime(orgSlug, pagedBeyondInitial);
  useCallsRealtime(organisationId, pagedBeyondInitial);

  const [waLead, setWaLead] = React.useState<Lead | null>(null);
  const [waOpen, setWaOpen] = React.useState(false);
  const [reminderLead, setReminderLead] = React.useState<Lead | null>(null);
  const [reminderOpen, setReminderOpen] = React.useState(false);
  const [detailLeadId, setDetailLeadId] = React.useState<string | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [pendingLeadId, setPendingLeadId] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const detailLead = React.useMemo(
    () =>
      detailLeadId ? (items.find((l) => l.id === detailLeadId) ?? null) : null,
    [items, detailLeadId],
  );

  function openWhatsApp(lead: Lead) {
    setWaLead(lead);
    setWaOpen(true);
  }
  function openReminder(lead: Lead) {
    setReminderLead(lead);
    setReminderOpen(true);
  }
  function openDetail(lead: Lead) {
    setDetailLeadId(lead.id);
    setDetailOpen(true);
  }
  function onTogglePendingAction(lead: Lead) {
    setPendingLeadId(lead.id);
    startTransition(async () => {
      const result = await toggleLeadPendingAction(lead.id);
      setPendingLeadId(null);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }
  function onDelete(lead: Lead) {
    if (!confirm("Delete this lead? This can't be undone.")) return;
    setPendingLeadId(lead.id);
    startTransition(async () => {
      const result = await deleteLead(lead.id);
      setPendingLeadId(null);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Lead removed");
      if (detailLeadId === lead.id) setDetailOpen(false);
      router.refresh();
    });
  }
  function onCall(lead: Lead) {
    if (!lead.phone) {
      toast.error("No phone on file");
      return;
    }
    setPendingLeadId(lead.id);
    startTransition(async () => {
      const result = await initiateCall({ lead_id: lead.id });
      setPendingLeadId(null);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Calling ${lead.name ?? "lead"}…`);
      router.refresh();
    });
  }

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAppliedSearch(search.trim());
  }
  function clearSearch() {
    setSearch("");
    setAppliedSearch("");
  }

  function addFilter(def: LeadFieldDefinition) {
    setFilters((prev) => [
      ...prev,
      {
        source: def.source_column,
        category: def.category ?? "",
        key: def.key_path,
        op: def.data_type === "string" ? "contains" : "eq",
        value: "",
        type: def.data_type,
        label: def.label ?? def.key_path,
      },
    ]);
  }
  function updateFilter(index: number, patch: Partial<DynamicFilterValue>) {
    setFilters((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    );
  }
  function removeFilter(index: number) {
    setFilters((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <form
          onSubmit={onSearchSubmit}
          className="flex w-full max-w-md items-center gap-2"
        >
          <div className="relative flex-1">
            <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, notes, captured fields…"
              className="h-9 pl-8"
              aria-label="Search leads"
            />
            {search ? (
              <button
                type="button"
                onClick={clearSearch}
                aria-label="Clear search"
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            ) : null}
          </div>
          <Button type="submit" size="sm" variant="outline">
            Search
          </Button>
        </form>

        {filterableDefs.length > 0 ? (
          <FilterMenu defs={filterableDefs} onAdd={addFilter} />
        ) : null}
      </div>

      {filters.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {filters.map((f, i) => (
            <FilterChip
              key={`${f.key}-${i}`}
              filter={f}
              onChange={(patch) => updateFilter(i, patch)}
              onRemove={() => removeFilter(i)}
            />
          ))}
        </div>
      ) : null}

      {items.length === 0 ? (
        <Card className="items-center gap-3 py-24 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-muted">
            <PhoneIcon className="size-6 text-muted-foreground" />
          </span>
          <p className="text-base font-medium">
            {appliedSearch || filters.length > 0
              ? "No leads match these filters"
              : "No leads yet"}
          </p>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            {appliedSearch || filters.length > 0
              ? "Try adjusting the filters or clearing the search."
              : "Inbound calls captured by your voice agent will appear here, and outbound calls you place will land here too."}
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table
              className={cn(
                "w-full text-left text-sm",
                dynamicColumns.length > 0 ? "min-w-[1400px]" : "min-w-[1200px]",
              )}
            >
              <thead className="border-b border-border/60 bg-muted/30">
                <tr className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="px-5 py-4 font-medium">Lead</th>
                  <th scope="col" className="px-3 py-4 text-right font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <PhoneIncomingIcon className="size-3.5" /> In
                    </span>
                  </th>
                  <th scope="col" className="px-3 py-4 text-right font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <PhoneOutgoingIcon className="size-3.5" /> Out
                    </span>
                  </th>
                  <th scope="col" className="px-4 py-4 font-medium">Last contact</th>
                  <th scope="col" className="px-4 py-4 font-medium">First contact</th>
                  <th scope="col" className="px-4 py-4 font-medium">Intent</th>
                  {dynamicColumns.map((def) => (
                    <th
                      key={def.id}
                      scope="col"
                      className="px-4 py-4 font-medium"
                      title={def.key_path}
                    >
                      {def.label ?? humanise(def.key_path)}
                    </th>
                  ))}
                  <th scope="col" className="px-4 py-4 font-medium">Pending</th>
                  <th scope="col" className="px-5 py-4 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {items.map((row) => {
                  const intent = row.lead_intent ?? "cold";
                  const isPending = pending && pendingLeadId === row.id;
                  const hasPhone = Boolean(row.phone);
                  const actionPending = Boolean(row.pending_action);

                  return (
                    <tr
                      key={row.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open details for ${row.name ?? "lead"}`}
                      onClick={() => openDetail(row)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openDetail(row);
                        }
                      }}
                      className="group cursor-pointer align-top transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-start gap-3">
                          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
                            {initialsOf(row.name)}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium leading-tight">
                              {row.name ?? "Unnamed lead"}
                            </p>
                            {hasPhone ? (
                              <a
                                href={`tel:${row.phone}`}
                                onClick={(e) => e.stopPropagation()}
                                className="mt-0.5 inline-flex items-center gap-1.5 font-mono text-xs tabular-nums text-muted-foreground transition-colors hover:text-foreground"
                              >
                                <PhoneIcon className="size-3 shrink-0" />
                                {row.phone}
                              </a>
                            ) : (
                              <span className="mt-0.5 inline-flex items-center gap-1.5 text-xs italic text-muted-foreground">
                                <PhoneIcon className="size-3 shrink-0" />
                                No phone
                              </span>
                            )}
                            {row.interest ? (
                              <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                                {row.interest}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-4 text-right tabular-nums">{row.inbound_calls}</td>
                      <td className="px-3 py-4 text-right tabular-nums">{row.outbound_calls}</td>
                      <td className="px-4 py-4 text-xs text-muted-foreground" suppressHydrationWarning>
                        {now === null || !row.last_call_at ? "—" : formatRelative(row.last_call_at, now)}
                      </td>
                      <td className="px-4 py-4 text-xs text-muted-foreground" suppressHydrationWarning>
                        {now === null || !row.first_call_at ? "—" : formatRelative(row.first_call_at, now)}
                      </td>
                      <td className="px-4 py-4">
                        <Badge className={INTENT_CLASSES[intent]}>{INTENT_LABEL[intent]}</Badge>
                      </td>
                      {dynamicColumns.map((def) => (
                        <td
                          key={def.id}
                          className="px-4 py-4 text-sm text-muted-foreground"
                        >
                          {renderDynamicValue(readDynamicValue(row, def), def.data_type)}
                        </td>
                      ))}
                      <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                        <Badge
                          render={
                            <button
                              type="button"
                              onClick={() => onTogglePendingAction(row)}
                              disabled={isPending}
                              aria-pressed={!actionPending}
                              className="disabled:cursor-not-allowed disabled:opacity-60"
                            />
                          }
                          variant="outline"
                          className={cn(
                            actionPending
                              ? "border-red-200 bg-red-100 text-red-700 hover:bg-red-100/80 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300"
                              : "border-emerald-200 bg-emerald-100 text-emerald-700 hover:bg-emerald-100/80 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300",
                          )}
                          title={actionPending ? "Click to mark as done" : "Click to reopen action"}
                        >
                          <CheckIcon />
                          {actionPending ? "Pending" : "Done"}
                        </Badge>
                      </td>
                      <td className="px-5 py-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => onCall(row)}
                            disabled={isPending || !hasPhone}
                            aria-label="Call"
                            title={hasPhone ? "Place a call" : "No phone on file"}
                          >
                            <PhoneIcon />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => openWhatsApp(row)}
                            disabled={!hasPhone}
                            aria-label="WhatsApp"
                            title={hasPhone ? "Open WhatsApp" : "No phone on file"}
                          >
                            <WhatsAppIcon className="size-4" />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => openReminder(row)}
                            aria-label="Remind"
                            title="Schedule a reminder"
                          >
                            <BellPlusIcon />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <InfiniteScrollFooter
        loading={loading}
        hasMore={hasMore}
        loadedCount={items.length}
        total={liveTotal}
        sentinelRef={sentinelRef}
      />

      <WhatsAppDialog
        key={waLead?.id ?? "wa-empty"}
        lead={waLead}
        open={waOpen}
        onOpenChange={setWaOpen}
      />
      <ReminderDialog
        organisationId={organisationId}
        leadId={reminderLead?.id}
        leadName={reminderLead?.name}
        open={reminderOpen}
        onOpenChange={setReminderOpen}
      />
      <LeadDetailSheet
        lead={detailLead}
        organisationId={organisationId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        pending={pending}
        onCall={onCall}
        onOpenWhatsApp={openWhatsApp}
        onOpenReminder={openReminder}
        onToggleContacted={onTogglePendingAction}
        onDelete={onDelete}
      />
    </>
  );
}

function FilterMenu({
  defs,
  onAdd,
}: {
  defs: LeadFieldDefinition[];
  onAdd: (def: LeadFieldDefinition) => void;
}) {
  const [pickerValue, setPickerValue] = React.useState<string>("");

  function onPick(value: string | null) {
    if (!value) return;
    const def = defs.find((d) => d.id === value);
    if (!def) return;
    onAdd(def);
    setPickerValue("");
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={pickerValue} onValueChange={onPick}>
        <SelectTrigger className="h-9 w-[180px]">
          <SelectValue placeholder="+ Add filter" />
        </SelectTrigger>
        <SelectContent>
          {defs.map((def) => (
            <SelectItem key={def.id} value={def.id}>
              {def.label ?? humanise(def.key_path)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function FilterChip({
  filter,
  onChange,
  onRemove,
}: {
  filter: DynamicFilterValue;
  onChange: (patch: Partial<DynamicFilterValue>) => void;
  onRemove: () => void;
}) {
  const opOptions = OP_OPTIONS_BY_TYPE[filter.type] ?? OP_OPTIONS_BY_TYPE.string;
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs">
      <span className="font-medium">{filter.label}</span>
      <Select
        value={filter.op}
        onValueChange={(v) => onChange({ op: v as LeadActivityFilter["op"] })}
      >
        <SelectTrigger className="h-7 w-[110px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opOptions.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {filter.type === "boolean" ? (
        <Select
          value={filter.value || "true"}
          onValueChange={(v) => v !== null && onChange({ value: v })}
        >
          <SelectTrigger className="h-7 w-[80px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Yes</SelectItem>
            <SelectItem value="false">No</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <Input
          value={filter.value}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder="value"
          type={
            filter.type === "number"
              ? "number"
              : filter.type === "date"
                ? "date"
                : "text"
          }
          className="h-7 w-[120px]"
        />
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove filter"
        className="ml-0.5 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}

const OP_OPTIONS_BY_TYPE: Record<
  LeadFieldDefinition["data_type"],
  Array<{ value: LeadActivityFilter["op"]; label: string }>
> = {
  string: [
    { value: "contains", label: "contains" },
    { value: "eq", label: "is" },
    { value: "neq", label: "is not" },
  ],
  enum: [
    { value: "eq", label: "is" },
    { value: "neq", label: "is not" },
  ],
  number: [
    { value: "eq", label: "=" },
    { value: "neq", label: "≠" },
    { value: "lt", label: "<" },
    { value: "lte", label: "≤" },
    { value: "gt", label: ">" },
    { value: "gte", label: "≥" },
  ],
  date: [
    { value: "eq", label: "on" },
    { value: "lt", label: "before" },
    { value: "gt", label: "after" },
  ],
  boolean: [
    { value: "eq", label: "is" },
  ],
  unknown: [
    { value: "contains", label: "contains" },
    { value: "eq", label: "is" },
  ],
};

function humanise(key: string): string {
  return key
    .split("_")
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}
