"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  BellPlusIcon,
  CheckIcon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
  PhoneIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InfiniteScrollFooter } from "@/components/app/infinite-scroll-footer";
import { LeadDetailSheet } from "@/components/app/lead-detail-sheet";
import { ReminderDialog } from "@/components/app/reminder-dialog";
import { WhatsAppDialog } from "@/components/app/whatsapp-dialog";
import { WhatsAppIcon } from "@/components/brand/whatsapp-icon";
import { deleteLead, listLeads, toggleLeadPendingAction } from "@/actions/leads";
import { initiateCall } from "@/actions/calls";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useClientNow } from "@/hooks/use-client-now";
import { useInfiniteList } from "@/hooks/use-infinite-list";
import { useLeadsRealtime } from "@/hooks/use-leads-realtime";
import type { Lead, LeadIntent, LeadStatus } from "@/types/lead";

// Hot stays destructive (red). Warm uses an amber/yellow chip. Cold uses our
// brand primary so a "cold" lead reads as the baseline state, not as muted.
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

// Column metadata drives both <colgroup> widths and the resize handles. Order
// here must match the visual order of <th>/<td> pairs below.
const COLUMN_KEYS = [
  "name",
  "phone",
  "interest",
  "customer_type",
  "visit",
  "created",
  "intent",
  "actionable",
  "pending_action",
  "actions",
] as const;
type ColumnKey = (typeof COLUMN_KEYS)[number];

const DEFAULT_WIDTHS: Record<ColumnKey, number> = {
  name: 200,
  phone: 180,
  interest: 160,
  customer_type: 160,
  visit: 160,
  created: 140,
  intent: 100,
  actionable: 240,
  pending_action: 160,
  actions: 180,
};

const MIN_COLUMN_WIDTH = 80;
const COLUMN_WIDTH_STORAGE_KEY = "skello.leads-table.col-widths.v1";

function useColumnWidths() {
  const [widths, setWidths] =
    React.useState<Record<ColumnKey, number>>(DEFAULT_WIDTHS);

  // Hydrate from localStorage on the client only — SSR has no window.
  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLUMN_WIDTH_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as unknown;
      if (!parsed || typeof parsed !== "object") return;
      const next: Record<ColumnKey, number> = { ...DEFAULT_WIDTHS };
      for (const key of COLUMN_KEYS) {
        const value = (parsed as Record<string, unknown>)[key];
        if (typeof value === "number" && Number.isFinite(value)) {
          next[key] = Math.max(MIN_COLUMN_WIDTH, Math.round(value));
        }
      }
      setWidths(next);
    } catch {
      // Corrupt entry — ignore, defaults are fine.
    }
  }, []);

  const setWidth = React.useCallback((key: ColumnKey, width: number) => {
    setWidths((prev) => {
      const next = {
        ...prev,
        [key]: Math.max(MIN_COLUMN_WIDTH, Math.round(width)),
      };
      try {
        window.localStorage.setItem(
          COLUMN_WIDTH_STORAGE_KEY,
          JSON.stringify(next),
        );
      } catch {
        // Quota or denied storage — non-fatal.
      }
      return next;
    });
  }, []);

  const totalWidth = COLUMN_KEYS.reduce((sum, k) => sum + widths[k], 0);
  return { widths, setWidth, totalWidth };
}

function ColumnResizer({
  columnKey,
  getWidth,
  setWidth,
}: {
  columnKey: ColumnKey;
  getWidth: () => number;
  setWidth: (key: ColumnKey, width: number) => void;
}) {
  const startXRef = React.useRef(0);
  const startWidthRef = React.useRef(0);
  const [dragging, setDragging] = React.useState(false);

  React.useEffect(() => {
    if (!dragging) return;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMove(e: MouseEvent) {
      const delta = e.clientX - startXRef.current;
      setWidth(columnKey, startWidthRef.current + delta);
    }
    function stopDrag() {
      setDragging(false);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", stopDrag);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", stopDrag);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
    };
  }, [dragging, columnKey, setWidth]);

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      onMouseDown={(e) => {
        // Don't open the row, don't bubble to <th>.
        e.preventDefault();
        e.stopPropagation();
        startXRef.current = e.clientX;
        startWidthRef.current = getWidth();
        setDragging(true);
      }}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "absolute right-0 top-1/4 z-10 h-1/2 w-1.5 cursor-col-resize select-none rounded-full bg-border transition-colors hover:bg-primary/60",
        dragging && "bg-primary hover:bg-primary",
      )}
    />
  );
}

export interface LeadsTableFilters {
  q?: string;
  intent?: LeadIntent;
  pending_action?: boolean;
  status?: LeadStatus;
}

interface LeadsTableProps {
  leads: Lead[];
  total: number;
  pageSize: number;
  organisationId: string;
  orgSlug: string;
  filters: LeadsTableFilters;
}

export function LeadsTable({
  leads,
  total,
  pageSize,
  organisationId,
  orgSlug,
  filters,
}: LeadsTableProps) {
  const { widths, setWidth, totalWidth } = useColumnWidths();
  const router = useRouter();

  const fetchPage = React.useCallback(
    async (offset: number, limit: number) => {
      const res = await listLeads({
        org_slug: orgSlug,
        limit,
        offset,
        q: filters.q,
        lead_intent: filters.intent,
        pending_action: filters.pending_action,
        status: filters.status,
      });
      if (!res.success) {
        toast.error(res.error);
        return null;
      }
      return res.data;
    },
    [orgSlug, filters.q, filters.intent, filters.pending_action, filters.status],
  );

  const {
    items,
    total: liveTotal,
    loading,
    hasMore,
    pagedBeyondInitial,
    sentinelRef,
  } = useInfiniteList<Lead>({
    initialItems: leads,
    initialTotal: total,
    pageSize,
    fetchPage,
  });

  // Pause realtime once we've scrolled past the initial page so a single
  // event doesn't snap the user back to row 50.
  useLeadsRealtime(orgSlug, pagedBeyondInitial);

  const [waLead, setWaLead] = React.useState<Lead | null>(null);
  const [waOpen, setWaOpen] = React.useState(false);
  const [reminderLead, setReminderLead] = React.useState<Lead | null>(null);
  const [reminderOpen, setReminderOpen] = React.useState(false);
  const [detailLeadId, setDetailLeadId] = React.useState<string | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [pendingLeadId, setPendingLeadId] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const now = useClientNow();

  // Always read the freshest lead from the live array so the sheet stays in
  // sync after router.refresh() (e.g., after Mark-done re-runs).
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

  if (items.length === 0) {
    return (
      <Card className="items-center gap-3 py-24 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-muted">
          <PhoneIcon className="size-6 text-muted-foreground" />
        </span>
        <p className="text-base font-medium">No leads yet</p>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          Inbound calls captured by your voice agent will appear here. You can
          also add a lead manually from the top right.
        </p>
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table
            style={{ width: totalWidth, tableLayout: "fixed" }}
            className="text-left text-sm"
          >
            <colgroup>
              {COLUMN_KEYS.map((key) => (
                <col key={key} style={{ width: widths[key] }} />
              ))}
            </colgroup>
            <thead className="border-b border-border/60 bg-muted/30">
              <tr className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th scope="col" className="relative px-5 py-4 font-medium">
                  Lead Name
                  <ColumnResizer
                    columnKey="name"
                    getWidth={() => widths.name}
                    setWidth={setWidth}
                  />
                </th>
                <th scope="col" className="relative px-5 py-4 font-medium">
                  Phone
                  <ColumnResizer
                    columnKey="phone"
                    getWidth={() => widths.phone}
                    setWidth={setWidth}
                  />
                </th>
                <th scope="col" className="relative px-5 py-4 font-medium">
                  Interest
                  <ColumnResizer
                    columnKey="interest"
                    getWidth={() => widths.interest}
                    setWidth={setWidth}
                  />
                </th>
                <th scope="col" className="relative px-5 py-4 font-medium">
                  Created
                  <ColumnResizer
                    columnKey="created"
                    getWidth={() => widths.created}
                    setWidth={setWidth}
                  />
                </th>
                <th scope="col" className="relative px-5 py-4 font-medium">
                  Customer Type
                  <ColumnResizer
                    columnKey="customer_type"
                    getWidth={() => widths.customer_type}
                    setWidth={setWidth}
                  />
                </th>
                <th scope="col" className="relative px-5 py-4 font-medium">
                  Visit
                  <ColumnResizer
                    columnKey="visit"
                    getWidth={() => widths.visit}
                    setWidth={setWidth}
                  />
                </th>

                <th scope="col" className="relative px-5 py-4 font-medium">
                  Intent
                  <ColumnResizer
                    columnKey="intent"
                    getWidth={() => widths.intent}
                    setWidth={setWidth}
                  />
                </th>
                <th scope="col" className="relative px-5 py-4 font-medium">
                  Actionable
                  <ColumnResizer
                    columnKey="actionable"
                    getWidth={() => widths.actionable}
                    setWidth={setWidth}
                  />
                </th>
                <th scope="col" className="relative px-5 py-4 font-medium">
                  Pending Action
                  <ColumnResizer
                    columnKey="pending_action"
                    getWidth={() => widths.pending_action}
                    setWidth={setWidth}
                  />
                </th>
                <th
                  scope="col"
                  className="relative px-5 py-4 text-right font-medium"
                >
                  Actions
                  <ColumnResizer
                    columnKey="actions"
                    getWidth={() => widths.actions}
                    setWidth={setWidth}
                  />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {items.map((lead) => {
                const intent = lead.lead_intent ?? "cold";
                const isPending = pending && pendingLeadId === lead.id;
                const hasPhone = Boolean(lead.phone);
                const actionPending = Boolean(lead.pending_action);

                return (
                  <tr
                    key={lead.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open details for ${lead.name ?? "lead"}`}
                    onClick={() => openDetail(lead)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openDetail(lead);
                      }
                    }}
                    className="group cursor-pointer align-middle transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                  >
                    <td className="px-5 py-5">
                      <span
                        className="block truncate text-sm font-medium"
                        title={lead.name ?? undefined}
                      >
                        {lead.name ?? "Unnamed lead"}
                      </span>
                    </td>
                    <td className="px-5 py-5">
                      {hasPhone ? (
                        <a
                          href={`tel:${lead.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          title={lead.phone ?? undefined}
                          className="flex items-center gap-1.5 truncate font-mono text-xs tabular-nums text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <PhoneIcon className="size-3.5 shrink-0" />
                          <span className="truncate">{lead.phone}</span>
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs italic text-muted-foreground">
                          <PhoneIcon className="size-3.5 shrink-0" />
                          No phone
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-5 text-sm text-muted-foreground">
                      <span
                        className="block truncate"
                        title={lead.interest ?? undefined}
                      >
                        {lead.interest ?? "—"}
                      </span>
                    </td>
                    <td
                      className="px-5 py-5 text-xs text-muted-foreground"
                      suppressHydrationWarning
                    >
                      {now === null ? "" : formatRelative(lead.created_at, now)}
                    </td>
                    <td className="px-5 py-5 text-sm text-muted-foreground">
                      <span
                        className="block truncate"
                        title={lead.customer_status ?? undefined}
                      >
                        {lead.customer_status ?? "—"}
                      </span>
                    </td>
                    <td
                      className="px-5 py-5 text-xs text-muted-foreground"
                      suppressHydrationWarning
                    >
                      {lead.visit_date_time
                        ? formatDateTime(lead.visit_date_time)
                        : "—"}
                    </td>

                    <td className="px-5 py-5">
                      <Badge className={INTENT_CLASSES[intent]}>
                        {INTENT_LABEL[intent]}
                      </Badge>
                    </td>
                    <td className="px-5 py-5 text-sm text-muted-foreground">
                      <span
                        className="block truncate"
                        title={lead.actionable ?? undefined}
                      >
                        {lead.actionable ?? "—"}
                      </span>
                    </td>
                    <td
                      className="px-5 py-5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Badge
                        render={
                          <button
                            type="button"
                            onClick={() => onTogglePendingAction(lead)}
                            disabled={isPending}
                            aria-pressed={!actionPending}
                            className="disabled:cursor-not-allowed disabled:opacity-60"
                          />
                        }
                        variant="outline"
                        className={
                          actionPending
                            ? "border-red-200 bg-red-100 text-red-700 hover:bg-red-100/80 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300"
                            : "border-emerald-200 bg-emerald-100 text-emerald-700 hover:bg-emerald-100/80 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300"
                        }
                        title={
                          actionPending
                            ? "Click to mark as done"
                            : "Click to reopen action"
                        }
                      >
                        <CheckIcon />
                        {actionPending ? "Mark as Done" : "Done"}
                      </Badge>
                    </td>
                    <td
                      className="px-5 py-5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => onCall(lead)}
                          disabled={isPending || !hasPhone}
                          aria-label="Call"
                          title={hasPhone ? "Place a call" : "No phone on file"}
                        >
                          <PhoneIcon />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => openWhatsApp(lead)}
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
                          onClick={() => openReminder(lead)}
                          aria-label="Remind"
                          title="Schedule a reminder"
                        >
                          <BellPlusIcon />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="More actions"
                              />
                            }
                          >
                            <MoreHorizontalIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem onClick={() => openDetail(lead)}>
                              <ExternalLinkIcon /> View details
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => onTogglePendingAction(lead)}
                              disabled={isPending}
                            >
                              <CheckIcon />
                              {actionPending ? "Mark as done" : "Reopen action"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => onDelete(lead)}
                              disabled={isPending}
                            >
                              <Trash2Icon /> Delete lead
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

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
