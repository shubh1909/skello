"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BellPlusIcon,
  CheckIcon,
  ChevronsUpDownIcon,
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
import { LeadExportDialog } from "@/components/app/lead-export-dialog";
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
import { ColumnResizeHandle, useColumnWidths } from "@/hooks/use-column-widths";
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
//
// Storage convention (matches `apply_lead_field_jsonb` in migration 0002
// and the path-building in `lead_call_activity`):
//   - lead_data:                   lead.lead_data[key_path]
//   - custom_data, category "":    lead.custom_data[key_path]            (flat)
//   - custom_data, named category: lead.custom_data[category][key_path]  (nested)
// The ungrouped case is flattened so admins don't see `custom_data.""`
// when they JSON-inspect a lead — keys land at the top level.
function readDynamicValue(lead: Lead, def: LeadFieldDefinition): unknown {
  if (def.source_column === "lead_data") {
    const blob = lead.lead_data as Record<string, unknown> | null | undefined;
    return blob?.[def.key_path] ?? null;
  }
  const cd = lead.custom_data as Record<string, unknown> | null | undefined;
  if (!cd) return null;
  const category = def.category ?? "";
  if (category === "") {
    return cd[def.key_path] ?? null;
  }
  const bag = cd[category] as Record<string, unknown> | undefined;
  return bag?.[def.key_path] ?? null;
}

function renderDynamicValue(
  value: unknown,
  type: LeadFieldDefinition["data_type"],
): React.ReactNode {
  if (value === null || value === undefined)
    return <span className="text-muted-foreground">—</span>;
  if (type === "boolean") {
    const truthy =
      value === true ||
      (typeof value === "string" &&
        ["true", "yes", "1"].includes(value.toLowerCase()));
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

// Column-width persistence — keyed per-user per-org in localStorage so each
// operator can shape the leads table to their own workflow. Defaults below
// are catalog-aware so call counters render narrower than dates etc. The
// `useColumnWidths` hook + ColumnResizeHandle live in `hooks/` and are
// shared with the conversations table.
const COL_KEY_LEAD = "__lead";
const COL_KEY_ACTIONS = "__actions";
const DEFAULT_LEAD_WIDTH = 220;
const DEFAULT_ACTIONS_WIDTH = 140;
const DEFAULT_DYNAMIC_WIDTH = 160;

function columnKeyFor(def: LeadFieldDefinition): string {
  return `${def.source_column}:${def.category ?? ""}:${def.key_path}`;
}

function defaultWidthFor(def: LeadFieldDefinition): number {
  if (def.source_column === "column") {
    switch (def.key_path) {
      case "inbound_calls":
      case "outbound_calls":
      case "total_calls":
        return 100;
      case "current_intent":
        return 110;
      case "pending_action":
        return 130;
      case "last_call_at":
      case "first_call_at":
        return 170;
    }
  }
  if (def.data_type === "date") return 170;
  if (def.data_type === "boolean") return 100;
  if (def.data_type === "number") return 120;
  return DEFAULT_DYNAMIC_WIDTH;
}

interface LeadsActivityTableProps {
  rows: LeadWithCallActivity[];
  total: number;
  pageSize: number;
  organisationId: string;
  orgSlug: string;
  includeZeroCalls: boolean;
  // Full catalog (visible + hidden). The table component decides per-flag
  // what each row contributes: visible_in_table → column rendering,
  // filterable → filter picker entry, sortable → sort dropdown entry.
  catalog: LeadFieldDefinition[];
  initialSearch?: string;
}

interface SortState {
  source: "column" | "lead_data" | "custom_data";
  category: string;
  key: string;
  dir: "asc" | "desc";
  type: "text" | "number" | "date" | "boolean";
}

// Map a catalog data_type to the RPC's sort_by `type` field.
function dataTypeToSortType(
  t: LeadFieldDefinition["data_type"],
): SortState["type"] {
  if (t === "number") return "number";
  if (t === "date") return "date";
  if (t === "boolean") return "boolean";
  return "text";
}

export function LeadsActivityTable({
  rows,
  total,
  pageSize,
  organisationId,
  orgSlug,
  includeZeroCalls,
  catalog,
  initialSearch = "",
}: LeadsActivityTableProps) {
  const router = useRouter();
  const now = useClientNow();

  const [search, setSearch] = React.useState(initialSearch);
  const [appliedSearch, setAppliedSearch] = React.useState(initialSearch);
  const [filters, setFilters] = React.useState<DynamicFilterValue[]>([]);
  const [sort, setSort] = React.useState<SortState | null>(null);

  // Per-user column widths, persisted in localStorage and scoped by org so
  // each workspace remembers its own layout. `widthFor` resolves to the
  // stored value or the catalog-derived default.
  const { widths, makeResizeStarter } = useColumnWidths(
    `leads-table-widths:${orgSlug}`,
  );
  const widthForLead = widths[COL_KEY_LEAD] ?? DEFAULT_LEAD_WIDTH;
  const widthForActions = widths[COL_KEY_ACTIONS] ?? DEFAULT_ACTIONS_WIDTH;
  function widthForCol(def: LeadFieldDefinition): number {
    return widths[columnKeyFor(def)] ?? defaultWidthFor(def);
  }

  // Visible columns (in display_order) — drive both the <th> and <td> render.
  const visibleColumns = React.useMemo(
    () =>
      catalog
        .filter((d) => d.visible_in_table)
        .slice()
        .sort((a, b) => a.display_order - b.display_order),
    [catalog],
  );
  // Filter picker draws from everything flagged filterable, independent of
  // whether that field is a visible column. This is the bug fix the user
  // hit: previously the page only fetched visible rows so filter-only
  // fields never appeared.
  const filterableDefs = React.useMemo(
    () => catalog.filter((d) => d.filterable),
    [catalog],
  );
  const sortableDefs = React.useMemo(
    () =>
      catalog
        .filter((d) => d.sortable)
        .slice()
        .sort((a, b) => a.display_order - b.display_order),
    [catalog],
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
        sort_by: sort ?? undefined,
        search: appliedSearch || undefined,
      });
      if (!res.success) {
        toast.error(res.error);
        return null;
      }
      return res.data;
    },
    [orgSlug, includeZeroCalls, wireFilters, sort, appliedSearch],
  );

  // Click a sortable header → cycle none → desc → asc → none.
  // Switching to a different column always starts at desc (most-recent-first
  // is the more useful default for dates and counts).
  function toggleSort(def: LeadFieldDefinition) {
    if (!def.sortable) return;
    const sourceFor: SortState["source"] =
      def.source_column === "column"
        ? "column"
        : def.source_column === "lead_data"
          ? "lead_data"
          : "custom_data";
    const isCurrent =
      sort &&
      sort.source === sourceFor &&
      sort.key === def.key_path &&
      sort.category === (def.category ?? "");
    if (!isCurrent) {
      setSort({
        source: sourceFor,
        category: def.category ?? "",
        key: def.key_path,
        dir: "desc",
        type: dataTypeToSortType(def.data_type),
      });
      return;
    }
    if (sort.dir === "desc") {
      setSort({ ...sort, dir: "asc" });
      return;
    }
    // Was asc — clear sort.
    setSort(null);
  }

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
    // Re-fetch from offset 0 whenever client-side query state changes —
    // sort toggle on a header, filter chip added/edited, search submitted.
    // Without this, the table keeps showing the server-rendered initial
    // page (no sort/filter) while later-scrolled pages reflect the new
    // params, producing an inconsistent list.
    resetKey: JSON.stringify({
      sort,
      wireFilters,
      appliedSearch,
    }),
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
        // Match the filter picker's display rule — admin-set label first,
        // then a humanised version of the raw key_path. The previous fallback
        // was the raw key (e.g. `interest_Objective`) which read worse than
        // "Interest Objective" once it landed on the chip.
        label: def.label ?? humanise(def.key_path),
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

        <div className="flex items-center gap-2">
          {filterableDefs.length > 0 ? (
            <FilterMenu defs={filterableDefs} onAdd={addFilter} />
          ) : null}
          <LeadExportDialog
            tableFilters={wireFilters}
            tableSearch={appliedSearch}
          />
        </div>
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
            <table className="w-full table-fixed text-left text-sm">
              <colgroup>
                <col style={{ width: `${widthForLead}px` }} />
                {visibleColumns.map((def) => (
                  <col
                    key={def.id}
                    style={{ width: `${widthForCol(def)}px` }}
                  />
                ))}
                <col style={{ width: `${widthForActions}px` }} />
              </colgroup>
              <thead className="border-b border-border/60 bg-muted/30">
                <tr className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="relative px-4 py-4 font-medium">
                    Lead
                    <ColumnResizeHandle
                      onStart={makeResizeStarter(COL_KEY_LEAD, widthForLead)}
                    />
                  </th>
                  {visibleColumns.map((def) => (
                    <ColumnHeader
                      key={def.id}
                      def={def}
                      sort={sort}
                      onToggleSort={toggleSort}
                      onResizeStart={makeResizeStarter(
                        columnKeyFor(def),
                        widthForCol(def),
                      )}
                    />
                  ))}
                  <th
                    scope="col"
                    className="relative px-5 py-4 text-right font-medium"
                  >
                    Actions
                    <ColumnResizeHandle
                      onStart={makeResizeStarter(
                        COL_KEY_ACTIONS,
                        widthForActions,
                      )}
                    />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {items.map((row) => {
                  const isPending = pending && pendingLeadId === row.id;
                  const hasPhone = Boolean(row.phone);

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
                      <td className="px-4 py-4">
                        <div className="flex items-start gap-2.5">
                          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
                            {initialsOf(row.name)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium leading-tight">
                              {row.name ?? "Unnamed"}
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
                          </div>
                        </div>
                      </td>
                      {visibleColumns.map((def) => (
                        <ColumnCell
                          key={def.id}
                          def={def}
                          row={row}
                          now={now}
                          pendingBusy={isPending}
                          onTogglePending={() => onTogglePendingAction(row)}
                        />
                      ))}
                      <td
                        className="px-5 py-4"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => onCall(row)}
                            disabled={isPending || !hasPhone}
                            aria-label="Call"
                            title={
                              hasPhone ? "Place a call" : "No phone on file"
                            }
                          >
                            <PhoneIcon />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => openWhatsApp(row)}
                            disabled={!hasPhone}
                            aria-label="WhatsApp"
                            title={
                              hasPhone ? "Open WhatsApp" : "No phone on file"
                            }
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
        catalog={catalog}
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
  const opOptions =
    OP_OPTIONS_BY_TYPE[filter.type] ?? OP_OPTIONS_BY_TYPE.string;
  // Base UI's <SelectValue/> renders the raw `value` string by default — so
  // without an explicit render function the trigger shows "eq", "neq", etc.
  // We pass a children fn that maps the value back to the option label.
  const currentOpLabel =
    opOptions.find((o) => o.value === filter.op)?.label ?? filter.op;
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs">
      <span className="font-medium">{filter.label}</span>
      <Select
        value={filter.op}
        onValueChange={(v) => onChange({ op: v as LeadActivityFilter["op"] })}
      >
        <SelectTrigger className="h-7 w-[110px]">
          <SelectValue>{currentOpLabel}</SelectValue>
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
  boolean: [{ value: "eq", label: "is" }],
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

// ---------------------------------------------------------------------------
// Catalog-driven column rendering. The leads table has three structural
// columns (Lead identifier on the left, Actions on the right) and N
// catalog-driven middle columns. This block centralises:
//   - per-column header content + alignment
//   - per-column cell content (first-class columns get their old custom
//     renderers; dynamic JSONB columns share one generic renderer)
//   - sortable header buttons with arrow indicators
// ---------------------------------------------------------------------------

// Visual treatment differs by column. Returns the `<th>`/`<td>` className
// pair plus whether the cell content should be wrapped in a stop-propagation
// container (Pending's interactive badge).
function columnLayout(def: LeadFieldDefinition): {
  thClass: string;
  tdClass: string;
  align: "left" | "right" | "center";
  stopRowClick: boolean;
} {
  if (def.source_column === "column") {
    switch (def.key_path) {
      case "inbound_calls":
      case "outbound_calls":
      case "total_calls":
        return {
          thClass: "px-3 py-4 text-right font-medium",
          tdClass: "px-3 py-4 text-right tabular-nums",
          align: "right",
          stopRowClick: false,
        };
      case "last_call_at":
      case "first_call_at":
        return {
          thClass: "px-4 py-4 font-medium",
          tdClass: "px-4 py-4 text-xs text-muted-foreground",
          align: "left",
          stopRowClick: false,
        };
      case "pending_action":
        return {
          thClass: "px-4 py-4 font-medium",
          tdClass: "px-4 py-4",
          align: "left",
          stopRowClick: true,
        };
      default:
        return {
          thClass: "px-4 py-4 font-medium",
          tdClass: "px-4 py-4",
          align: "left",
          stopRowClick: false,
        };
    }
  }
  return {
    thClass: "px-4 py-4 font-medium",
    tdClass: "px-4 py-4 text-sm text-muted-foreground",
    align: "left",
    stopRowClick: false,
  };
}

function columnLabel(def: LeadFieldDefinition): React.ReactNode {
  if (def.source_column === "column" && def.key_path === "inbound_calls") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <PhoneIncomingIcon className="size-3.5" /> {def.label ?? "In"}
      </span>
    );
  }
  if (def.source_column === "column" && def.key_path === "outbound_calls") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <PhoneOutgoingIcon className="size-3.5" /> {def.label ?? "Out"}
      </span>
    );
  }
  return def.label ?? humanise(def.key_path);
}

function ColumnHeader({
  def,
  sort,
  onToggleSort,
  onResizeStart,
}: {
  def: LeadFieldDefinition;
  sort: SortState | null;
  onToggleSort: (def: LeadFieldDefinition) => void;
  onResizeStart: (e: React.MouseEvent) => void;
}) {
  const layout = columnLayout(def);
  const label = columnLabel(def);
  const sourceFor: SortState["source"] =
    def.source_column === "column"
      ? "column"
      : def.source_column === "lead_data"
        ? "lead_data"
        : "custom_data";
  const isCurrent =
    sort &&
    sort.source === sourceFor &&
    sort.key === def.key_path &&
    sort.category === (def.category ?? "");
  const dir = isCurrent ? sort.dir : null;

  const thClass = cn("relative", layout.thClass);

  if (!def.sortable) {
    return (
      <th scope="col" className={thClass} title={def.key_path}>
        {label}
        <ColumnResizeHandle onStart={onResizeStart} />
      </th>
    );
  }
  return (
    <th scope="col" className={thClass} title={def.key_path}>
      <button
        type="button"
        onClick={() => onToggleSort(def)}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm text-inherit transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          layout.align === "right" && "flex-row-reverse",
          isCurrent && "text-foreground",
        )}
        aria-label={`Sort by ${def.label ?? humanise(def.key_path)}`}
      >
        {label}
        {dir === "asc" ? (
          <ArrowUpIcon className="size-3" />
        ) : dir === "desc" ? (
          <ArrowDownIcon className="size-3" />
        ) : (
          <ChevronsUpDownIcon className="size-3 opacity-40" />
        )}
      </button>
      <ColumnResizeHandle onStart={onResizeStart} />
    </th>
  );
}

function ColumnCell({
  def,
  row,
  now,
  pendingBusy,
  onTogglePending,
}: {
  def: LeadFieldDefinition;
  row: LeadWithCallActivity;
  now: number | null;
  pendingBusy: boolean;
  onTogglePending: () => void;
}) {
  const layout = columnLayout(def);

  // First-class columns — each is hand-rendered for the right typography.
  if (def.source_column === "column") {
    switch (def.key_path) {
      case "inbound_calls":
        return <td className={layout.tdClass}>{row.inbound_calls}</td>;
      case "outbound_calls":
        return <td className={layout.tdClass}>{row.outbound_calls}</td>;
      case "total_calls":
        // Bold so the sum stands out from its inbound/outbound components
        // when all three columns are visible side-by-side.
        return (
          <td className={cn(layout.tdClass, "text-sm font-semibold")}>
            {row.total_calls}
          </td>
        );
      case "last_call_at":
        return (
          <td className={layout.tdClass} suppressHydrationWarning>
            {now === null || !row.last_call_at
              ? "—"
              : formatRelative(row.last_call_at, now)}
          </td>
        );
      case "first_call_at":
        return (
          <td className={layout.tdClass} suppressHydrationWarning>
            {now === null || !row.first_call_at
              ? "—"
              : formatRelative(row.first_call_at, now)}
          </td>
        );
      case "current_intent": {
        const intent = row.lead_intent ?? "cold";
        return (
          <td className={layout.tdClass}>
            <Badge className={INTENT_CLASSES[intent]}>
              {INTENT_LABEL[intent]}
            </Badge>
          </td>
        );
      }
      case "pending_action": {
        const actionPending = Boolean(row.pending_action);
        return (
          <td className={layout.tdClass} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTogglePending();
              }}
              disabled={pendingBusy}
              aria-pressed={!actionPending}
              title={
                actionPending
                  ? "Click to mark as done"
                  : "Click to reopen action"
              }
              className={cn(
                "inline-flex h-5 items-center gap-1 rounded-4xl border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all",
                "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                "disabled:cursor-not-allowed disabled:opacity-60",
                "[&>svg]:size-3",
                actionPending
                  ? "border-red-200 bg-red-100 text-red-700 hover:bg-red-100/80 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300"
                  : "border-emerald-200 bg-emerald-100 text-emerald-700 hover:bg-emerald-100/80 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300",
              )}
            >
              <CheckIcon />
              {actionPending ? "Pending" : "Done"}
            </button>
          </td>
        );
      }
      default:
        // Unknown first-class key — render the raw value (admin added it
        // via SQL? It's reachable but unsupported).
        return <td className={layout.tdClass}>—</td>;
    }
  }

  // JSONB-backed dynamic column.
  return (
    <td className={layout.tdClass}>
      {renderDynamicValue(readDynamicValue(row, def), def.data_type)}
    </td>
  );
}
