"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  BellPlusIcon,
  CheckIcon,
  ExternalLinkIcon,
  MessageCircleIcon,
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
import {
  deleteLead,
  toggleLeadContactedOnWhatsApp,
} from "@/actions/leads";
import { initiateCall } from "@/actions/calls";
import { formatRelative, initialsOf } from "@/lib/format";
import { useClientNow } from "@/hooks/use-client-now";
import type { Lead, LeadIntent, LeadStatus } from "@/types/lead";

const INTENT_VARIANT: Record<
  LeadIntent,
  "destructive" | "secondary" | "outline"
> = {
  hot: "destructive",
  warm: "secondary",
  cold: "outline",
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

const STATUS_VARIANT: Record<
  LeadStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  new: "outline",
  contacted: "secondary",
  qualified: "secondary",
  negotiating: "default",
  won: "default",
  lost: "destructive",
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
  // sync after router.refresh() (e.g., after Mark-contacted re-runs).
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
  function onToggleContacted(lead: Lead) {
    setPendingLeadId(lead.id);
    startTransition(async () => {
      const result = await toggleLeadContactedOnWhatsApp(lead.id);
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
      <Card className="items-center gap-3 py-16 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-muted">
          <PhoneIcon className="size-5 text-muted-foreground" />
        </span>
        <p className="font-medium">No leads yet</p>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
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
                <th scope="col" className="px-3 py-3 font-medium">Lead</th>
                <th scope="col" className="px-3 py-3 font-medium">Phone</th>
                <th scope="col" className="w-40 px-3 py-3 font-medium">Product</th>
                <th scope="col" className="px-3 py-3 font-medium">Status</th>
                <th scope="col" className="px-3 py-3 font-medium">Intent</th>
                <th scope="col" className="px-3 py-3 font-medium">Contacted</th>
                <th scope="col" className="px-3 py-3 font-medium">Created</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {leads.map((lead) => {
                const intent = lead.lead_intent ?? "cold";
                const isPending = pending && pendingLeadId === lead.id;
                const hasPhone = Boolean(lead.phone);
                const contacted = Boolean(lead.contacted_on_watsapp);

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
                    <td className="px-3 py-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground transition-colors group-hover:bg-muted-foreground/10">
                          {initialsOf(lead.name)}
                        </span>
                        <span className="truncate font-medium">
                          {lead.name ?? "Unnamed lead"}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {hasPhone ? (
                        <a
                          href={`tel:${lead.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 font-mono text-xs tabular-nums text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <PhoneIcon className="size-3" />
                          {lead.phone}
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs italic text-muted-foreground">
                          <PhoneIcon className="size-3" />
                          No phone
                        </span>
                      )}
                    </td>
                    <td className="w-40 px-3 py-3 text-muted-foreground">
                      <span className="block w-40 truncate">
                        {lead.product ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant={STATUS_VARIANT[lead.status]}>
                        {STATUS_LABEL[lead.status]}
                      </Badge>
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant={INTENT_VARIANT[intent]}>
                        {INTENT_LABEL[intent]}
                      </Badge>
                    </td>
                    <td
                      className="px-3 py-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Badge
                        render={
                          <button
                            type="button"
                            onClick={() => onToggleContacted(lead)}
                            disabled={isPending}
                            aria-pressed={contacted}
                            className="disabled:cursor-not-allowed disabled:opacity-60"
                          />
                        }
                        variant={contacted ? "secondary" : "outline"}
                        title={
                          contacted
                            ? "Click to mark as not contacted"
                            : "Click to mark as contacted"
                        }
                      >
                        <CheckIcon />
                        {contacted ? "Contacted" : "Mark"}
                      </Badge>
                    </td>
                    <td
                      className="px-3 py-3 text-xs text-muted-foreground"
                      suppressHydrationWarning
                    >
                      {now === null ? "" : formatRelative(lead.created_at, now)}
                    </td>
                    <td
                      className="px-3 py-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1">
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
                          <MessageCircleIcon />
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
                              onClick={() => onToggleContacted(lead)}
                              disabled={isPending}
                            >
                              <CheckIcon />
                              {contacted
                                ? "Mark as not contacted"
                                : "Mark as contacted"}
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
        onToggleContacted={onToggleContacted}
        onDelete={onDelete}
      />
    </>
  );
}
