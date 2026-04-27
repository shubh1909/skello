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
import { LeadDetailSheet } from "@/components/app/lead-detail-sheet";
import { ReminderDialog } from "@/components/app/reminder-dialog";
import { WhatsAppDialog } from "@/components/app/whatsapp-dialog";
import { WhatsAppIcon } from "@/components/brand/whatsapp-icon";
import {
  deleteLead,
  toggleLeadPendingAction,
} from "@/actions/leads";
import { initiateCall } from "@/actions/calls";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useClientNow } from "@/hooks/use-client-now";
import type { Lead, LeadIntent } from "@/types/lead";

// Hot stays destructive (red). Warm uses an amber/yellow chip. Cold uses our
// brand primary so a "cold" lead reads as the baseline state, not as muted.
const INTENT_CLASSES: Record<LeadIntent, string> = {
  hot: "border-transparent bg-destructive/10 text-destructive dark:bg-destructive/20",
  warm:
    "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300",
  cold: "border-transparent bg-primary text-primary-foreground",
};

const INTENT_LABEL: Record<LeadIntent, string> = {
  hot: "Hot",
  warm: "Warm",
  cold: "Cold",
};

interface LeadsTableProps {
  leads: Lead[];
  organisationId: string;
}

export function LeadsTable({ leads, organisationId }: LeadsTableProps) {
  const router = useRouter();
  const [waLead, setWaLead] = React.useState<Lead | null>(null);
  const [waOpen, setWaOpen] = React.useState(false);
  const [reminderLead, setReminderLead] = React.useState<Lead | null>(null);
  const [reminderOpen, setReminderOpen] = React.useState(false);
  const [detailLeadId, setDetailLeadId] = React.useState<string | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [pendingLeadId, setPendingLeadId] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const now = useClientNow();

  // Always read the freshest lead from the prop array so the sheet stays in
  // sync after router.refresh() (e.g., after Mark-done re-runs).
  const detailLead = React.useMemo(
    () => (detailLeadId ? leads.find((l) => l.id === detailLeadId) ?? null : null),
    [leads, detailLeadId],
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

  if (leads.length === 0) {
    return (
      <Card className="items-center gap-3 py-24 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-muted">
          <PhoneIcon className="size-6 text-muted-foreground" />
        </span>
        <p className="text-base font-medium">No leads yet</p>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          Inbound calls captured by your voice agent will appear here. You
          can also add a lead manually from the top right.
        </p>
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border/60 bg-muted/30">
              <tr className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th scope="col" className="px-5 py-4 font-medium">Lead Name</th>
                <th scope="col" className="px-5 py-4 font-medium">Phone</th>
                <th scope="col" className="w-32 px-5 py-4 font-medium">Interest</th>
                <th scope="col" className="px-5 py-4 font-medium">Customer Type</th>
                <th scope="col" className="px-5 py-4 font-medium">Visit</th>
                <th scope="col" className="px-5 py-4 font-medium">Created</th>
                <th scope="col" className="px-5 py-4 font-medium">Intent</th>
                <th scope="col" className="px-5 py-4 font-medium">Pending Action</th>
                <th scope="col" className="px-5 py-4 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {leads.map((lead) => {
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
                      <span className="block truncate text-sm font-medium">
                        {lead.name ?? "Unnamed lead"}
                      </span>
                    </td>
                    <td className="px-5 py-5">
                      {hasPhone ? (
                        <a
                          href={`tel:${lead.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 font-mono text-xs tabular-nums text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <PhoneIcon className="size-3.5" />
                          {lead.phone}
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs italic text-muted-foreground">
                          <PhoneIcon className="size-3.5" />
                          No phone
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-5 text-sm text-muted-foreground">
                      <span className="block max-w-32 truncate">
                        {lead.interest ?? "—"}
                      </span>
                    </td>
                    <td className="px-5 py-5 text-sm text-muted-foreground">
                      <span className="block max-w-40 truncate">
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
                    <td
                      className="px-5 py-5 text-xs text-muted-foreground"
                      suppressHydrationWarning
                    >
                      {now === null ? "" : formatRelative(lead.created_at, now)}
                    </td>
                    <td className="px-5 py-5">
                      <Badge className={INTENT_CLASSES[intent]}>
                        {INTENT_LABEL[intent]}
                      </Badge>
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
                          title={hasPhone ? "Open WhatsApp" : "No phone on file"}
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
