"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  BellPlusIcon,
  CheckIcon,
  PhoneIcon,
  PhoneIncomingIcon,
  PhoneOutgoingIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LeadDetailSheet } from "@/components/app/lead-detail-sheet";
import { ReminderDialog } from "@/components/app/reminder-dialog";
import { WhatsAppDialog } from "@/components/app/whatsapp-dialog";
import { WhatsAppIcon } from "@/components/brand/whatsapp-icon";
import { deleteLead, toggleLeadPendingAction } from "@/actions/leads";
import { initiateCall } from "@/actions/calls";
import { formatRelative, initialsOf } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useClientNow } from "@/hooks/use-client-now";
import { useCallsRealtime } from "@/hooks/use-calls-realtime";
import { useLeadsRealtime } from "@/hooks/use-leads-realtime";
import type { LeadWithCallActivity } from "@/actions/lead-activity";
import type { Lead, LeadIntent, LeadStatus } from "@/types/lead";

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

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  negotiating: "Negotiating",
  won: "Won",
  lost: "Lost",
};

const STATUS_VARIANT: Record<LeadStatus, "default" | "secondary" | "outline"> = {
  new: "outline",
  contacted: "secondary",
  qualified: "default",
  negotiating: "default",
  won: "default",
  lost: "outline",
};

function formatDuration(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds < 0) return "—";
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  const m = Math.floor(totalSeconds / 60);
  const s = Math.round(totalSeconds % 60);
  if (m < 60) return s === 0 ? `${m}m` : `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm === 0 ? `${h}h` : `${h}h ${rm}m`;
}

interface LeadsActivityTableProps {
  rows: LeadWithCallActivity[];
  organisationId: string;
  orgSlug: string;
}

export function LeadsActivityTable({
  rows,
  organisationId,
  orgSlug,
}: LeadsActivityTableProps) {
  const router = useRouter();
  const now = useClientNow();
  // Refresh on bursts of lead OR call changes — both shift the displayed
  // counts and ordering. Hooks debounce internally so concurrent fires
  // collapse to one server round-trip.
  useLeadsRealtime(orgSlug);
  useCallsRealtime(organisationId);

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
      detailLeadId ? (rows.find((l) => l.id === detailLeadId) ?? null) : null,
    [rows, detailLeadId],
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

  if (rows.length === 0) {
    return (
      <Card className="items-center gap-3 py-24 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-muted">
          <PhoneIcon className="size-6 text-muted-foreground" />
        </span>
        <p className="text-base font-medium">No leads yet</p>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          Inbound calls captured by your voice agent will appear here, and
          outbound calls you place will land here too.
        </p>
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] text-left text-sm">
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
                <th scope="col" className="px-3 py-4 text-right font-medium">
                  Total
                </th>
                <th scope="col" className="px-3 py-4 text-right font-medium">
                  Talk time
                </th>
                <th scope="col" className="px-4 py-4 font-medium">Last contact</th>
                <th scope="col" className="px-4 py-4 font-medium">First contact</th>
                <th scope="col" className="px-4 py-4 font-medium">Intent</th>
                <th scope="col" className="px-4 py-4 font-medium">Status</th>
                <th scope="col" className="px-4 py-4 font-medium">Pending</th>
                <th scope="col" className="px-5 py-4 text-right font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((row) => {
                const intent = row.lead_intent ?? "cold";
                const status = row.status;
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
                    <td className="px-3 py-4 text-right tabular-nums">
                      {row.inbound_calls}
                    </td>
                    <td className="px-3 py-4 text-right tabular-nums">
                      {row.outbound_calls}
                    </td>
                    <td className="px-3 py-4 text-right text-sm font-semibold tabular-nums">
                      {row.total_calls}
                    </td>
                    <td className="px-3 py-4 text-right text-xs tabular-nums text-muted-foreground">
                      {formatDuration(row.total_duration_seconds)}
                    </td>
                    <td
                      className="px-4 py-4 text-xs text-muted-foreground"
                      suppressHydrationWarning
                    >
                      {now === null || !row.last_call_at
                        ? "—"
                        : formatRelative(row.last_call_at, now)}
                    </td>
                    <td
                      className="px-4 py-4 text-xs text-muted-foreground"
                      suppressHydrationWarning
                    >
                      {now === null || !row.first_call_at
                        ? "—"
                        : formatRelative(row.first_call_at, now)}
                    </td>
                    <td className="px-4 py-4">
                      <Badge className={INTENT_CLASSES[intent]}>
                        {INTENT_LABEL[intent]}
                      </Badge>
                    </td>
                    <td className="px-4 py-4">
                      <Badge variant={STATUS_VARIANT[status]}>
                        {STATUS_LABEL[status]}
                      </Badge>
                    </td>
                    <td
                      className="px-4 py-4"
                      onClick={(e) => e.stopPropagation()}
                    >
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
                        title={
                          actionPending
                            ? "Click to mark as done"
                            : "Click to reopen action"
                        }
                      >
                        <CheckIcon />
                        {actionPending ? "Pending" : "Done"}
                      </Badge>
                    </td>
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
