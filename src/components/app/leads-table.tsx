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
import type { Lead, LeadIntent } from "@/types/lead";

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
      // Close the detail sheet if it was showing the deleted lead.
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
          Inbound calls captured by Bolna will appear here. You can also add a
          lead manually from the top right.
        </p>
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden p-0">
        <ul className="divide-y divide-border/60">
          {leads.map((lead) => {
            const intent = lead.lead_intent ?? "cold";
            const isPending = pending && pendingLeadId === lead.id;
            const hasPhone = Boolean(lead.phone);
            const contacted = Boolean(lead.contacted_on_watsapp);

            return (
              <li
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
                className="group flex cursor-pointer flex-col gap-3 px-4 py-4 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none md:flex-row md:items-center md:gap-4 md:px-5"
              >
                {/* Identity + meta */}
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium text-muted-foreground transition-colors group-hover:bg-muted-foreground/10">
                    {initialsOf(lead.name)}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate text-sm font-medium transition-colors group-hover:text-muted-foreground">
                        {lead.name ?? "Unnamed lead"}
                      </span>
                      <Badge variant={INTENT_VARIANT[intent]}>
                        {INTENT_LABEL[intent]}
                      </Badge>
                      <Badge
                        render={
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleContacted(lead);
                            }}
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
                        {contacted ? "Contacted" : "Mark contacted"}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {hasPhone ? (
                        <a
                          href={`tel:${lead.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 font-mono tabular-nums transition-colors hover:text-foreground"
                        >
                          <PhoneIcon className="size-3" />
                          {lead.phone}
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-1 italic">
                          <PhoneIcon className="size-3" />
                          No phone
                        </span>
                      )}
                      <span aria-hidden>·</span>
                      <span className="truncate">
                        {lead.product ?? "No product"}
                      </span>
                      <span aria-hidden>·</span>
                      <span className="truncate">
                        {lead.customer_status ?? "New"}
                      </span>
                      <span aria-hidden>·</span>
                      <span suppressHydrationWarning>
                        {now === null
                          ? ""
                          : formatRelative(lead.created_at, now)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions — stop click from reaching the row's onClick handler */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="flex flex-wrap items-center justify-end gap-1.5 md:flex-nowrap"
                >
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onCall(lead)}
                    disabled={isPending || !hasPhone}
                    title={hasPhone ? "Call via Bolna" : "No phone on file"}
                  >
                    <PhoneIcon />
                    <span className="hidden sm:inline">Call</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openWhatsApp(lead)}
                    disabled={!hasPhone}
                    title={hasPhone ? "Open WhatsApp" : "No phone on file"}
                  >
                    <MessageCircleIcon />
                    <span className="hidden sm:inline">WhatsApp</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openReminder(lead)}
                    title="Schedule a reminder"
                  >
                    <BellPlusIcon />
                    <span className="hidden sm:inline">Remind</span>
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
              </li>
            );
          })}
        </ul>
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
