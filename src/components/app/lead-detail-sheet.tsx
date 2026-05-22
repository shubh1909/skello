"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftIcon,
  BellPlusIcon,
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  HistoryIcon,
  Loader2Icon,
  MessageCircleIcon,
  PencilIcon,
  PhoneIcon,
  PhoneIncomingIcon,
  PhoneOutgoingIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { LeadFieldLock } from "@/components/app/lead-field-lock";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { listReminders } from "@/actions/reminders";
import { listCalls } from "@/actions/calls";
import { listCallTranscript } from "@/actions/call-transcripts";
import { updateLead } from "@/actions/leads";
import {
  formatDateTime,
  formatRelative,
  fromLocalDateTimeInput,
  initialsOf,
  toLocalDateTimeInputValue,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { useClientNow } from "@/hooks/use-client-now";
import type { Lead, LeadIntent, LeadSource, LeadStatus } from "@/types/lead";
import type { Reminder } from "@/types/reminder";
import type { Call, CallStatus } from "@/types/call";
import type {
  CallTranscriptTurn,
  CallTurnSpeaker,
} from "@/types/call-transcript";

const CALLS_PAGE_SIZE = 20;
const DEFAULT_VISIBLE_CALLS = 8;

const SPEAKER_LABEL: Record<CallTurnSpeaker, string> = {
  agent: "Agent",
  user: "Caller",
  system: "System",
};

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

const CALL_STATUS_VARIANT: Record<
  CallStatus,
  "secondary" | "destructive" | "outline" | "default"
> = {
  initiated: "default",
  ringing: "default",
  in_progress: "default",
  completed: "secondary",
  failed: "destructive",
  no_answer: "outline",
  busy: "outline",
  canceled: "outline",
};

const CALL_STATUS_LABEL: Record<CallStatus, string> = {
  initiated: "Dialling",
  ringing: "Ringing",
  in_progress: "Live",
  completed: "Completed",
  failed: "Failed",
  no_answer: "No answer",
  busy: "Busy",
  canceled: "Canceled",
};

interface LeadDetailSheetProps {
  lead: Lead | null;
  organisationId: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  pending: boolean;
  onCall: (lead: Lead) => void;
  onOpenWhatsApp: (lead: Lead) => void;
  onOpenReminder: (lead: Lead) => void;
  onToggleContacted: (lead: Lead) => void;
  onDelete: (lead: Lead) => void;
}

export function LeadDetailSheet({
  lead,
  organisationId,
  open,
  onOpenChange,
  pending,
  onCall,
  onOpenWhatsApp,
  onOpenReminder,
  onToggleContacted,
  onDelete,
}: LeadDetailSheetProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [reminders, setReminders] = React.useState<Reminder[] | null>(null);
  const [calls, setCalls] = React.useState<Call[] | null>(null);
  const [callsTotal, setCallsTotal] = React.useState(0);
  const [callsLoadingMore, setCallsLoadingMore] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<EditForm | null>(null);
  const [saving, startSaveTransition] = React.useTransition();
  const [historyMode, setHistoryMode] = React.useState(false);
  const [selectedCallId, setSelectedCallId] = React.useState<string | null>(
    null,
  );
  const now = useClientNow();

  const leadId = lead?.id ?? null;
  const editing = form !== null;
  const urlCallId = searchParams.get("call");

  // Sync history-mode state to the ?call=<id> query param.
  //  - on close, strip it
  //  - on entering history mode via row click, push the selection
  //  - on landing with ?call=<id> already present, switch to history mode and
  //    select the call when its row arrives in the loaded page
  const setCallInUrl = React.useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (id) next.set("call", id);
      else next.delete("call");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  React.useEffect(() => {
    setForm(null);
  }, [leadId, open]);

  // Hydrate history mode from the URL on open. We intentionally read the URL
  // only when the sheet opens for a new lead — once inside, the user's
  // interactions drive both selection and URL together via setCallInUrl.
  React.useEffect(() => {
    if (!open) {
      setHistoryMode(false);
      setSelectedCallId(null);
      return;
    }
    if (urlCallId) {
      setHistoryMode(true);
      setSelectedCallId(urlCallId);
    }
    // open changing is the only signal we need; urlCallId is read once on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, leadId]);

  React.useEffect(() => {
    if (!open || !leadId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setReminders(null);
    setCalls(null);
    setCallsTotal(0);
    (async () => {
      const [remindersResult, callsResult] = await Promise.all([
        listReminders({
          organisation_id: organisationId,
          lead_id: leadId,
          limit: 20,
          offset: 0,
        }),
        listCalls({
          organisation_id: organisationId,
          lead_id: leadId,
          limit: CALLS_PAGE_SIZE,
          offset: 0,
        }),
      ]);
      if (cancelled) return;
      if (!remindersResult.success) setError(remindersResult.error);
      else setReminders(remindersResult.data.items);
      if (!callsResult.success) {
        setError(callsResult.error);
      } else {
        setCalls(callsResult.data.items);
        setCallsTotal(callsResult.data.total);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, leadId, organisationId]);

  // If history mode is on but no call is selected (e.g. user toggled into
  // history without a target), default to the most recent call.
  React.useEffect(() => {
    if (!historyMode) return;
    if (selectedCallId) return;
    if (calls && calls.length > 0) {
      setSelectedCallId(calls[0].id);
    }
  }, [historyMode, selectedCallId, calls]);

  async function loadMoreCalls() {
    if (!leadId || callsLoadingMore) return;
    const offset = calls?.length ?? 0;
    if (offset >= callsTotal) return;
    setCallsLoadingMore(true);
    const result = await listCalls({
      organisation_id: organisationId,
      lead_id: leadId,
      limit: CALLS_PAGE_SIZE,
      offset,
    });
    setCallsLoadingMore(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setCalls((prev) => [...(prev ?? []), ...result.data.items]);
    setCallsTotal(result.data.total);
  }

  function enterHistory(callId?: string) {
    const target =
      callId ?? selectedCallId ?? (calls && calls[0]?.id) ?? null;
    setHistoryMode(true);
    if (target) {
      setSelectedCallId(target);
      setCallInUrl(target);
    }
  }
  function exitHistory() {
    setHistoryMode(false);
    setSelectedCallId(null);
    setCallInUrl(null);
  }
  function selectCall(id: string) {
    setSelectedCallId(id);
    setCallInUrl(id);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      // Always strip the ?call= param when the sheet closes; otherwise reopening
      // any lead row would silently re-enter history mode.
      setCallInUrl(null);
    }
    onOpenChange(next);
  }

  function startEdit() {
    if (!lead) return;
    setForm(leadToForm(lead));
    setError(null);
  }
  function cancelEdit() {
    setForm(null);
  }
  function onSave() {
    if (!lead || !form) return;
    const patch = diffForm(form, lead);
    if (Object.keys(patch).length === 0) {
      toast.info("No changes to save");
      setForm(null);
      return;
    }
    startSaveTransition(async () => {
      const result = await updateLead(lead.id, patch);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Lead updated");
      setForm(null);
      router.refresh();
    });
  }

  // useMemo must run on every render — keep it above the early return so
  // hook order stays stable when `lead` flips between null and a value.
  const selectedCall = React.useMemo(
    () => (calls && selectedCallId
      ? calls.find((c) => c.id === selectedCallId) ?? null
      : null),
    [calls, selectedCallId],
  );

  if (!lead) return null;

  const intent = lead.current_intent ?? lead.lead_intent ?? "cold";
  const isPending = Boolean(lead.pending_action);
  const hasPhone = Boolean(lead.phone);
  // Extras = everything in lead_data + custom_data that isn't already
  // surfaced in the Details dl. Drives whether the "Captured fields"
  // section renders at all.
  const leadDataExtras = pickLeadDataExtras(lead.lead_data, LEAD_DATA_SURFACED);
  const leadFieldGroups = buildCustomFieldGroups(
    lead.custom_data,
    leadDataExtras,
  );

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        className={cn(
          // Match the primitive's `data-[side=right]:sm:max-w-sm` selector
          // exactly — otherwise the attribute-prefixed default wins and the
          // sheet is stuck at 24rem.
          "w-full gap-0 p-0",
          // Mobile: sheet scrolls as one column. md+: in history mode each
          // pane scrolls itself; in summary mode the sheet still scrolls.
          historyMode
            ? "overflow-y-auto md:overflow-hidden data-[side=right]:w-[min(96vw,1280px)] data-[side=right]:sm:max-w-none"
            : "overflow-y-auto data-[side=right]:w-[min(96vw,560px)] data-[side=right]:sm:max-w-none",
        )}
      >
        <SheetHeader className="gap-3 border-b border-border/60 p-5 pr-12">
          <div className="flex items-start gap-3">
            {historyMode ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={exitHistory}
                aria-label="Back to lead summary"
                title="Back to lead summary"
              >
                <ArrowLeftIcon />
              </Button>
            ) : null}
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
              {initialsOf(lead.name)}
            </span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <SheetTitle className="truncate text-lg">
                {lead.name ?? "Unnamed lead"}
              </SheetTitle>
              <SheetDescription className="sr-only">
                Lead details and history
              </SheetDescription>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={INTENT_VARIANT[intent]}>
                  {INTENT_LABEL[intent]}
                </Badge>
                <Badge
                  render={
                    <button
                      type="button"
                      onClick={() => onToggleContacted(lead)}
                      disabled={pending}
                      aria-pressed={!isPending}
                      className="disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  }
                  className={
                    isPending
                      ? "border-red-200 bg-red-100 text-red-700 hover:bg-red-100/80 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300"
                      : "border-emerald-200 bg-emerald-100 text-emerald-700 hover:bg-emerald-100/80 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300"
                  }
                  variant="outline"
                >
                  <CheckIcon />
                  {isPending ? "Mark as Done" : "Done"}
                </Badge>
              </div>
            </div>
          </div>
        </SheetHeader>

        {historyMode ? (
          <HistoryView
            lead={lead}
            calls={calls}
            callsTotal={callsTotal}
            selectedCall={selectedCall}
            onSelectCall={selectCall}
            onLoadMore={loadMoreCalls}
            loadingMore={callsLoadingMore}
            now={now}
          />
        ) : (
        <div className="flex-1 space-y-5 px-5 pb-5">
          <div className="grid grid-cols-3 gap-2">
            <Button
              variant="outline"
              onClick={() => onCall(lead)}
              disabled={pending || !hasPhone}
              title={hasPhone ? "Place a call" : "No phone on file"}
            >
              <PhoneIcon />
              Call
            </Button>
            <Button
              variant="outline"
              onClick={() => onOpenWhatsApp(lead)}
              disabled={!hasPhone}
            >
              <MessageCircleIcon />
              WhatsApp
            </Button>
            <Button variant="outline" onClick={() => onOpenReminder(lead)}>
              <BellPlusIcon />
              Remind
            </Button>
          </div>

          <Separator />

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <SectionTitle>Details</SectionTitle>
              {editing ? (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={cancelEdit}
                    disabled={saving}
                  >
                    <XIcon /> Cancel
                  </Button>
                  <Button size="xs" onClick={onSave} disabled={saving}>
                    {saving ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <CheckIcon />
                    )}
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" size="xs" onClick={startEdit}>
                  <PencilIcon /> Edit
                </Button>
              )}
            </div>

            {editing && form ? (
              <LeadEditForm
                form={form}
                onChange={setForm}
                disabled={saving}
              />
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <FieldWithLock
                  label="Name"
                  leadId={lead.id}
                  fieldPath="name"
                  value={lead.name}
                >
                  {lead.name ?? <Muted>Unnamed</Muted>}
                </FieldWithLock>
                <Field label="Phone">
                  {hasPhone ? (
                    <a
                      href={`tel:${lead.phone}`}
                      className="inline-flex items-center gap-1 font-mono tabular-nums text-foreground transition-colors hover:text-muted-foreground"
                    >
                      {lead.phone}
                      <ExternalLinkIcon className="size-3" />
                    </a>
                  ) : (
                    <span className="italic text-muted-foreground">
                      No phone
                    </span>
                  )}
                </Field>
                <FieldWithLock
                  label="Interest"
                  leadId={lead.id}
                  fieldPath="lead_data.interest"
                  value={lead.interest}
                >
                  {lead.interest ?? <Muted>—</Muted>}
                </FieldWithLock>
                <FieldWithLock
                  label="Intent"
                  leadId={lead.id}
                  fieldPath="current_intent"
                  value={lead.current_intent}
                >
                  <Badge variant={INTENT_VARIANT[intent]}>
                    {INTENT_LABEL[intent]}
                  </Badge>
                </FieldWithLock>
                <FieldWithLock
                  label="Customer type"
                  leadId={lead.id}
                  fieldPath="lead_data.customer_status"
                  value={lead.customer_status}
                >
                  {lead.customer_status ?? <Muted>—</Muted>}
                </FieldWithLock>
                <FieldWithLock
                  label="City"
                  leadId={lead.id}
                  fieldPath="city"
                  value={lead.city}
                >
                  {lead.city ? (
                    <span>
                      {lead.city}
                      {lead.pincode ? (
                        <span className="ml-1 text-muted-foreground">
                          · {lead.pincode}
                        </span>
                      ) : null}
                    </span>
                  ) : lead.pincode ? (
                    <span>{lead.pincode}</span>
                  ) : (
                    <Muted>—</Muted>
                  )}
                </FieldWithLock>
                <Field label="Visit">
                  {lead.visit_date_time ? (
                    <span suppressHydrationWarning>
                      {formatDateTime(lead.visit_date_time)}
                    </span>
                  ) : (
                    <Muted>Not scheduled</Muted>
                  )}
                </Field>
                <Field label="Wants WA">
                  {lead.wants_to_connect_on_watsapp === true
                    ? "Yes"
                    : lead.wants_to_connect_on_watsapp === false
                      ? "No"
                      : <Muted>Unknown</Muted>}
                </Field>
                <Field label="First seen">
                  <span suppressHydrationWarning>
                    {now === null || !lead.first_seen_at
                      ? "—"
                      : formatRelative(lead.first_seen_at, now)}
                  </span>
                </Field>
                <Field label="Last contact">
                  <span suppressHydrationWarning>
                    {now === null || !lead.last_contact_at
                      ? "—"
                      : formatRelative(lead.last_contact_at, now)}
                  </span>
                </Field>
                {lead.recording_url ? (
                  <Field label="Latest recording">
                    <audio
                      controls
                      preload="none"
                      src={lead.recording_url}
                      className="h-8 w-full"
                    >
                      <track kind="captions" />
                    </audio>
                  </Field>
                ) : null}
                {lead.actionable ? (
                  <>
                    <dt className="col-span-2 pt-1 text-xs text-muted-foreground">
                      Latest call action
                    </dt>
                    <dd className="col-span-2 whitespace-pre-wrap rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm leading-relaxed">
                      {lead.actionable}
                    </dd>
                  </>
                ) : null}
                {lead.summary ? (
                  <>
                    <dt className="col-span-2 pt-1 text-xs text-muted-foreground">
                      Latest call summary
                    </dt>
                    <dd className="col-span-2 whitespace-pre-wrap rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm leading-relaxed">
                      {lead.summary}
                    </dd>
                  </>
                ) : null}
                {lead.notes ? (
                  <>
                    <dt className="col-span-2 pt-1 text-xs text-muted-foreground">
                      Notes
                    </dt>
                    <dd className="col-span-2 whitespace-pre-wrap rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm leading-relaxed">
                      {lead.notes}
                    </dd>
                  </>
                ) : null}
              </dl>
            )}
          </section>

          {leadFieldGroups.length > 0 ? (
            <>
              <Separator />
              <section className="space-y-3">
                <SectionTitle>Captured fields</SectionTitle>
                <CustomFieldsDisplay
                  customData={lead.custom_data}
                  extraLeadData={leadDataExtras}
                />
              </section>
            </>
          ) : null}

          <Separator />

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <SectionTitle>Reminders</SectionTitle>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => onOpenReminder(lead)}
              >
                <BellPlusIcon /> Add
              </Button>
            </div>
            {loading && reminders === null ? (
              <Skeleton />
            ) : reminders && reminders.length > 0 ? (
              <ul className="space-y-2">
                {reminders.slice(0, 5).map((r) => (
                  <ReminderRow key={r.id} reminder={r} now={now} />
                ))}
              </ul>
            ) : (
              <EmptyHint>No reminders for this lead yet.</EmptyHint>
            )}
          </section>

          <Separator />

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <SectionTitle>Call history</SectionTitle>
              {callsTotal > 0 ? (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => enterHistory()}
                >
                  <HistoryIcon /> Show all ({callsTotal})
                </Button>
              ) : null}
            </div>
            {loading && calls === null ? (
              <Skeleton />
            ) : calls && calls.length > 0 ? (
              <ul className="space-y-2">
                {calls.slice(0, DEFAULT_VISIBLE_CALLS).map((c) => (
                  <CallRow
                    key={c.id}
                    call={c}
                    now={now}
                    onSelect={() => enterHistory(c.id)}
                  />
                ))}
              </ul>
            ) : (
              <EmptyHint>No calls placed yet.</EmptyHint>
            )}
          </section>

          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        )}

        <SheetFooter className="border-t border-border/60 bg-muted/20">
          <Button
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onDelete(lead)}
            disabled={pending}
          >
            <Trash2Icon />
            Delete lead
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
      {children}
    </h3>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </>
  );
}

// Field row with a lock indicator. The lock widget itself fetches its
// state from lead_field_overrides; the field renders normally regardless.
function FieldWithLock({
  label,
  leadId,
  fieldPath,
  value,
  children,
}: {
  label: string;
  leadId: string;
  fieldPath: string;
  value: unknown;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        <LeadFieldLock leadId={leadId} fieldPath={fieldPath} value={value} />
      </dt>
      <dd className="text-sm">{children}</dd>
    </>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
      {children}
    </p>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2">
      <div className="h-8 animate-pulse rounded-md bg-muted/60" />
      <div className="h-8 animate-pulse rounded-md bg-muted/40" />
    </div>
  );
}

function ReminderRow({
  reminder,
  now,
}: {
  reminder: Reminder;
  now: number | null;
}) {
  const overdue =
    reminder.status === "pending" &&
    now !== null &&
    new Date(reminder.remind_at).getTime() < now;
  return (
    <li className="flex items-start gap-2 rounded-md border border-border/60 bg-card px-3 py-2">
      <ClockIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{reminder.title}</p>
        <p
          className={
            overdue
              ? "text-xs font-medium text-destructive"
              : "text-xs text-muted-foreground"
          }
          suppressHydrationWarning
        >
          {now === null
            ? ""
            : `${overdue ? "Overdue · " : ""}${formatRelative(
                reminder.remind_at,
                now,
              )} · ${reminder.type}`}
        </p>
      </div>
      <Badge
        variant={
          reminder.status === "done"
            ? "secondary"
            : overdue
              ? "destructive"
              : "outline"
        }
        className="mt-0.5"
      >
        {reminder.status === "done"
          ? "Done"
          : overdue
            ? "Overdue"
            : "Pending"}
      </Badge>
    </li>
  );
}

function HistoryView({
  lead,
  calls,
  callsTotal,
  selectedCall,
  onSelectCall,
  onLoadMore,
  loadingMore,
  now,
}: {
  lead: Lead;
  calls: Call[] | null;
  callsTotal: number;
  selectedCall: Call | null;
  onSelectCall: (id: string) => void;
  onLoadMore: () => void;
  loadingMore: boolean;
  now: number | null;
}) {
  const hasMore = (calls?.length ?? 0) < callsTotal;

  return (
    // Mobile: single column, sheet handles scrolling (no nested scrollers).
    // md+: two columns, each pane scrolls independently and the outer sheet
    // is overflow-hidden. flex-1 + min-h-0 only matter in the md+ case.
    <div className="grid grid-cols-1 md:min-h-0 md:flex-1 md:grid-cols-[320px_1fr]">
      {/* Left rail: paginated call list */}
      <aside className="flex flex-col border-b border-border/60 md:min-h-0 md:border-b-0 md:border-r">
        <header className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-4 py-3">
          <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Calls
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {calls?.length ?? 0} / {callsTotal}
          </span>
        </header>
        <div className="md:min-h-0 md:flex-1 md:overflow-y-auto">
          {calls === null ? (
            <div className="space-y-2 p-3">
              <Skeleton />
              <Skeleton />
            </div>
          ) : calls.length === 0 ? (
            <div className="p-4">
              <EmptyHint>No calls for this lead yet.</EmptyHint>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {calls.map((c) => (
                <HistoryRailRow
                  key={c.id}
                  call={c}
                  selected={selectedCall?.id === c.id}
                  onSelect={() => onSelectCall(c.id)}
                  now={now}
                />
              ))}
            </ul>
          )}
          {hasMore ? (
            <div className="p-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={onLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <Loader2Icon className="animate-spin" />
                ) : null}
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </div>
      </aside>

      {/* Right pane: selected call detail */}
      <div className="md:min-h-0 md:overflow-y-auto">
        {selectedCall ? (
          <CallDetailPane
            call={selectedCall}
            lead={lead}
            now={now}
          />
        ) : (
          <div className="flex min-h-80 items-center justify-center p-10 text-center text-sm text-muted-foreground md:h-full md:min-h-0">
            Select a call on the left to see its recording, transcript, and
            captured fields.
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryRailRow({
  call,
  selected,
  onSelect,
  now,
}: {
  call: Call;
  selected: boolean;
  onSelect: () => void;
  now: number | null;
}) {
  const inbound = call.direction === "inbound";
  const DirectionIcon = inbound ? PhoneIncomingIcon : PhoneOutgoingIcon;
  const counterparty = inbound ? call.from_phone : call.to_phone;
  const duration =
    typeof call.duration_seconds === "number"
      ? formatDuration(call.duration_seconds)
      : null;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full items-start gap-2 px-4 py-3 text-left transition-colors focus-visible:outline-none",
          selected
            ? "bg-muted text-foreground"
            : "hover:bg-muted/50 focus-visible:bg-muted/50",
        )}
      >
        <DirectionIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {counterparty ?? "Unknown number"}
          </p>
          <p
            className="text-xs text-muted-foreground"
            suppressHydrationWarning
          >
            {now === null ? "" : formatRelative(call.started_at, now)}
            {duration ? ` · ${duration}` : ""}
          </p>
        </div>
        <Badge variant={CALL_STATUS_VARIANT[call.status]} className="mt-0.5">
          {CALL_STATUS_LABEL[call.status]}
        </Badge>
      </button>
    </li>
  );
}

function CallDetailPane({
  call,
  lead,
  now,
}: {
  call: Call;
  lead: Lead;
  now: number | null;
}) {
  const [turns, setTurns] = React.useState<CallTranscriptTurn[] | null>(null);
  const [loading, setLoading] = React.useState(false);

  // Fetch transcript turns whenever the selected call changes. Independent
  // of the sheet's own fetch so we don't refetch the calls list every time
  // someone clicks a different row.
  React.useEffect(() => {
    let cancelled = false;
    setTurns(null);
    if (call.transcript_status !== "ready") {
      // Skip the fetch entirely — there's nothing to show yet.
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    (async () => {
      const result = await listCallTranscript({ call_id: call.id });
      if (cancelled) return;
      setLoading(false);
      if (!result.success) {
        toast.error(result.error);
        setTurns([]);
        return;
      }
      setTurns(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [call.id, call.transcript_status]);

  const inbound = call.direction === "inbound";
  const DirectionIcon = inbound ? PhoneIncomingIcon : PhoneOutgoingIcon;
  const counterparty = inbound ? call.from_phone : call.to_phone;
  const duration =
    typeof call.duration_seconds === "number"
      ? formatDuration(call.duration_seconds)
      : null;
  const intent = call.lead_intent_extracted;
  const extraLeadData = pickLeadDataExtras(call.lead_data, CALL_LEAD_DATA_SURFACED);
  const customFieldGroups = buildCustomFieldGroups(call.custom_data, extraLeadData);
  const hasExtras = customFieldGroups.length > 0;
  const snapshotFields: Array<[string, React.ReactNode]> = [];
  if (call.name_extracted) snapshotFields.push(["Name", call.name_extracted]);
  if (call.interest) snapshotFields.push(["Interest", call.interest]);
  if (intent)
    snapshotFields.push([
      "Intent",
      <Badge key="intent" variant={INTENT_VARIANT[intent]}>
        {INTENT_LABEL[intent]}
      </Badge>,
    ]);
  if (call.customer_status)
    snapshotFields.push(["Customer type", call.customer_status]);
  if (call.visit_scheduled_at)
    snapshotFields.push([
      "Visit scheduled",
      <span key="visit" suppressHydrationWarning>
        {formatDateTime(call.visit_scheduled_at)}
      </span>,
    ]);
  if (call.connect_on_whatsapp !== null)
    snapshotFields.push([
      "Wants WhatsApp",
      call.connect_on_whatsapp ? "Yes" : "No",
    ]);

  return (
    <article className="space-y-5 p-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            <DirectionIcon className="size-3" /> {inbound ? "Inbound" : "Outbound"}
          </Badge>
          <Badge variant={CALL_STATUS_VARIANT[call.status]}>
            {CALL_STATUS_LABEL[call.status]}
          </Badge>
          {duration ? (
            <span className="text-xs text-muted-foreground">· {duration}</span>
          ) : null}
          <span
            className="ml-auto text-xs text-muted-foreground"
            suppressHydrationWarning
          >
            {now === null ? "" : formatRelative(call.started_at, now)}
          </span>
        </div>
        <p className="font-mono text-sm tabular-nums">
          {counterparty ?? "Unknown number"}
          {lead.name ? (
            <span className="ml-2 text-muted-foreground">· {lead.name}</span>
          ) : null}
        </p>
        <p
          className="text-xs text-muted-foreground"
          suppressHydrationWarning
        >
          Started{" "}
          {call.started_at ? formatDateTime(call.started_at) : "—"}
          {call.ended_at ? ` · Ended ${formatDateTime(call.ended_at)}` : ""}
        </p>
      </header>

      {/* Inline audio player. Browser handles play/pause/seek/volume. */}
      {call.recording_url ? (
        <div className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Recording
          </div>
          <audio
            controls
            preload="none"
            src={call.recording_url}
            className="w-full"
          >
            <track kind="captions" />
          </audio>
        </div>
      ) : (
        <p className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs italic text-muted-foreground">
          No recording on file.
        </p>
      )}

      {call.summary ? (
        <section className="space-y-1.5">
          <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Summary
          </div>
          <p className="whitespace-pre-wrap rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm leading-relaxed">
            {call.summary}
          </p>
        </section>
      ) : null}

      {call.actionable ? (
        <section className="space-y-1.5">
          <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Actionable next step
          </div>
          <p className="whitespace-pre-wrap rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            {call.actionable}
          </p>
        </section>
      ) : null}

      {snapshotFields.length > 0 ? (
        <section className="space-y-1.5">
          <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Captured this call
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border border-border/70 bg-card px-3 py-2.5 text-sm">
            {snapshotFields.map(([label, value]) => (
              <React.Fragment key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd>{value}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>
      ) : null}

      {hasExtras ? (
        <section className="space-y-1.5">
          <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Additional fields
          </div>
          <CustomFieldsDisplay
            customData={call.custom_data}
            extraLeadData={extraLeadData}
          />
        </section>
      ) : null}

      <section className="space-y-2">
        <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Transcript
        </div>
        {loading && turns === null ? (
          <div className="flex items-center gap-2 px-1 py-6 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Loading transcript…
          </div>
        ) : turns && turns.length > 0 ? (
          <TranscriptBody turns={turns} />
        ) : call.transcript ? (
          <pre className="whitespace-pre-wrap rounded-md border border-border/60 bg-muted/30 p-3 text-xs leading-relaxed">
            {call.transcript}
          </pre>
        ) : (
          <p className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs italic text-muted-foreground">
            {transcriptEmptyCopy(call.transcript_status)}
          </p>
        )}
      </section>
    </article>
  );
}

// Keys we already surface in the per-call "Captured this call" dl —
// excluded from the extras section so they aren't shown twice.
const CALL_LEAD_DATA_SURFACED = new Set([
  "name",
  "interest",
  "lead_intent",
  "actionable",
  "customer_status",
  "connect_on_whatsapp",
  "date_and_time_of_visit",
  // Internal routing key from the extractor — never user-facing.
  "business_slug",
]);

// Same idea for the lead-level summary view.
const LEAD_DATA_SURFACED = new Set([
  "name",
  "interest",
  "lead_intent",
  "actionable",
  "customer_status",
  "connect_on_whatsapp",
  "date_and_time_of_visit",
  "city",
  "pincode",
  "business_slug",
]);

// Category names that mean "ungrouped" — we hoist their entries to the top
// level instead of rendering an empty "" header.
const UNGROUPED_CATEGORIES = new Set(["", "__general__", "general"]);

function pickLeadDataExtras(
  data: Record<string, unknown> | null | undefined,
  skip: ReadonlySet<string>,
): Record<string, unknown> | null {
  if (!data) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (skip.has(k)) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function humaniseFieldKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    // Insert spaces between camelCase / PascalCase boundaries.
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

function looksLikeIsoDate(s: string): boolean {
  const t = s.trim();
  if (t.length < 8) return false;
  return /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(t);
}

function renderFieldValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined) {
    return <Muted>—</Muted>;
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toLocaleString() : String(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return <Muted>—</Muted>;
    const lower = trimmed.toLowerCase();
    if (lower === "yes" || lower === "true") return "Yes";
    if (lower === "no" || lower === "false") return "No";
    if (looksLikeIsoDate(trimmed)) {
      const d = new Date(trimmed);
      if (!Number.isNaN(d.getTime())) {
        return (
          <span suppressHydrationWarning>{formatDateTime(trimmed)}</span>
        );
      }
    }
    return trimmed;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <Muted>—</Muted>;
    return value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ");
  }
  // Plain object — render as a compact code block so the structure is
  // still legible without dumping a multi-line JSON tree.
  return (
    <code className="wrap-break-word text-xs text-muted-foreground">
      {JSON.stringify(value)}
    </code>
  );
}

interface CustomFieldsGroup {
  category: string; // empty string for ungrouped
  entries: Array<[string, unknown]>;
}

function buildCustomFieldGroups(
  customData: Record<string, unknown> | null | undefined,
  extraLeadData: Record<string, unknown> | null | undefined,
): CustomFieldsGroup[] {
  const groups: CustomFieldsGroup[] = [];
  const ungrouped: Array<[string, unknown]> = [];

  if (extraLeadData) {
    for (const [k, v] of Object.entries(extraLeadData)) {
      if (v === null || v === undefined) continue;
      ungrouped.push([k, v]);
    }
  }

  if (customData && typeof customData === "object") {
    for (const [cat, bag] of Object.entries(customData)) {
      if (!bag || typeof bag !== "object") continue;
      const entries = Object.entries(bag as Record<string, unknown>).filter(
        ([, v]) => v !== null && v !== undefined && !(typeof v === "string" && v.trim() === ""),
      );
      if (entries.length === 0) continue;
      if (UNGROUPED_CATEGORIES.has(cat)) {
        ungrouped.push(...entries);
      } else {
        groups.push({ category: cat, entries });
      }
    }
  }

  if (ungrouped.length > 0) {
    groups.unshift({ category: "", entries: ungrouped });
  }
  return groups;
}

function CustomFieldsDisplay({
  customData,
  extraLeadData,
}: {
  customData?: Record<string, unknown> | null;
  extraLeadData?: Record<string, unknown> | null;
}) {
  const groups = React.useMemo(
    () => buildCustomFieldGroups(customData, extraLeadData),
    [customData, extraLeadData],
  );

  if (groups.length === 0) return null;

  return (
    <div className="space-y-3">
      {groups.map((g, i) => (
        <div key={`${g.category || "ungrouped"}-${i}`} className="space-y-1.5">
          {g.category ? (
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {humaniseFieldKey(g.category)}
            </div>
          ) : null}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border border-border/70 bg-card px-3 py-2.5 text-sm">
            {g.entries.map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="text-xs leading-relaxed text-muted-foreground">
                  {humaniseFieldKey(k)}
                </dt>
                <dd className="wrap-break-word leading-relaxed">
                  {renderFieldValue(v)}
                </dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

function TranscriptBody({ turns }: { turns: CallTranscriptTurn[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {turns.map((t) => {
        const isAgent = t.speaker === "agent";
        const isUser = t.speaker === "user";
        return (
          <li
            key={t.id}
            className={cn(
              "flex flex-col gap-0.5",
              isUser ? "items-end" : "items-start",
            )}
          >
            <span className="px-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              {SPEAKER_LABEL[t.speaker]}
            </span>
            <div
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                isAgent
                  ? "rounded-tl-sm bg-muted text-foreground"
                  : isUser
                    ? "rounded-tr-sm bg-primary text-primary-foreground"
                    : "rounded-md bg-muted/60 italic text-muted-foreground",
              )}
            >
              {t.text}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function transcriptEmptyCopy(status: string): string {
  switch (status) {
    case "pending":
      return "Transcript hasn't been fetched yet — check back in a moment.";
    case "processing":
      return "Transcript is being processed.";
    case "failed":
      return "We couldn't fetch this transcript.";
    case "skipped":
      return "No transcript was produced for this call.";
    case "ready":
      return "This call has no utterances on file.";
    default:
      return "No transcript to show.";
  }
}

function CallRow({
  call,
  now,
  onSelect,
}: {
  call: Call;
  now: number | null;
  onSelect: () => void;
}) {
  const duration =
    typeof call.duration_seconds === "number"
      ? formatDuration(call.duration_seconds)
      : null;
  const inbound = call.direction === "inbound";
  const DirectionIcon = inbound ? PhoneIncomingIcon : PhoneOutgoingIcon;
  const counterparty = inbound ? call.from_phone : call.to_phone;
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className="flex cursor-pointer items-start gap-2 rounded-md border border-border/60 bg-card px-3 py-2 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
    >
      <DirectionIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          <span className="text-muted-foreground">
            {inbound ? "Inbound from " : "Call to "}
          </span>
          <span className="font-mono tabular-nums">
            {counterparty ?? "unknown"}
          </span>
          {duration ? (
            <span className="text-muted-foreground"> · {duration}</span>
          ) : null}
        </p>
        <p
          className="text-xs text-muted-foreground"
          suppressHydrationWarning
        >
          {now === null ? "" : formatRelative(call.started_at, now)}
          {call.error_message ? ` · ${call.error_message}` : ""}
        </p>
      </div>
      <Badge variant={CALL_STATUS_VARIANT[call.status]} className="mt-0.5">
        {CALL_STATUS_LABEL[call.status]}
      </Badge>
    </li>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

// ---------------------------------------------------------------------------
// Edit mode — only fields that live at the lead level. Per-call fields
// (summary, actionable, recording_url, visit_date_time) are immutable
// snapshots and no longer editable from here. Visit time and WhatsApp
// preference moved out of the edit form for the same reason — they're
// LLM-extracted dynamic fields exposed via the catalog UI now.
// ---------------------------------------------------------------------------

interface EditForm {
  name: string;
  phone: string;
  interest: string;
  customer_status: string;
  lead_intent: LeadIntent | "";
  status: LeadStatus;
  source: LeadSource | "none";
  city: string;
  pincode: string;
  notes: string;
  wants_to_connect_on_watsapp: "yes" | "no" | "unknown";
  visit_date_time: string;
}

function leadToForm(lead: Lead): EditForm {
  return {
    name: lead.name ?? "",
    phone: lead.phone ?? "",
    interest: lead.interest ?? "",
    customer_status: lead.customer_status ?? "",
    lead_intent: (lead.current_intent ?? "") as LeadIntent | "",
    status: lead.status,
    source: lead.source ?? "none",
    city: lead.city ?? "",
    pincode: lead.pincode ?? "",
    notes: lead.notes ?? "",
    wants_to_connect_on_watsapp:
      lead.wants_to_connect_on_watsapp === true
        ? "yes"
        : lead.wants_to_connect_on_watsapp === false
          ? "no"
          : "unknown",
    visit_date_time: lead.visit_date_time
      ? toLocalDateTimeInputValue(lead.visit_date_time)
      : "",
  };
}

type LeadPatch = {
  name?: string | null;
  phone?: string | null;
  interest?: string | null;
  customer_status?: string | null;
  current_intent?: LeadIntent | null;
  status?: LeadStatus;
  source?: LeadSource | null;
  city?: string | null;
  pincode?: string | null;
  notes?: string | null;
  wants_to_connect_on_watsapp?: boolean | null;
  visit_date_time?: string | null;
};

function diffForm(form: EditForm, lead: Lead): LeadPatch {
  const patch: LeadPatch = {};
  const nextName = form.name.trim() || null;
  if (nextName !== (lead.name ?? null)) patch.name = nextName;

  const nextPhone = form.phone.trim() || null;
  if (nextPhone !== (lead.phone ?? null)) patch.phone = nextPhone;

  const nextInterest = form.interest.trim() || null;
  if (nextInterest !== (lead.interest ?? null)) patch.interest = nextInterest;

  const nextStatus = form.customer_status.trim() || null;
  if (nextStatus !== (lead.customer_status ?? null)) {
    patch.customer_status = nextStatus;
  }

  const nextIntent = (form.lead_intent || null) as LeadIntent | null;
  if (nextIntent !== (lead.current_intent ?? null)) {
    patch.current_intent = nextIntent;
  }

  if (form.status !== lead.status) patch.status = form.status;

  const nextSource = form.source === "none" ? null : form.source;
  if (nextSource !== (lead.source ?? null)) patch.source = nextSource;

  const nextCity = form.city.trim() || null;
  if (nextCity !== (lead.city ?? null)) patch.city = nextCity;

  const nextPincode = form.pincode.trim() || null;
  if (nextPincode !== (lead.pincode ?? null)) patch.pincode = nextPincode;

  const nextNotes = form.notes.trim() || null;
  if (nextNotes !== (lead.notes ?? null)) patch.notes = nextNotes;

  const nextWants =
    form.wants_to_connect_on_watsapp === "yes"
      ? true
      : form.wants_to_connect_on_watsapp === "no"
        ? false
        : null;
  if (nextWants !== (lead.wants_to_connect_on_watsapp ?? null)) {
    patch.wants_to_connect_on_watsapp = nextWants;
  }

  const nextVisitIso = form.visit_date_time
    ? fromLocalDateTimeInput(form.visit_date_time)
    : null;
  const currentVisitIso = lead.visit_date_time
    ? new Date(lead.visit_date_time).toISOString()
    : null;
  if (nextVisitIso !== currentVisitIso) patch.visit_date_time = nextVisitIso;

  return patch;
}

function LeadEditForm({
  form,
  onChange,
  disabled,
}: {
  form: EditForm;
  onChange: (next: EditForm) => void;
  disabled: boolean;
}) {
  function update<K extends keyof EditForm>(key: K, value: EditForm[K]) {
    onChange({ ...form, [key]: value });
  }
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="edit-name">Name</Label>
        <Input
          id="edit-name"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          disabled={disabled}
          maxLength={200}
          placeholder="Jane Cooper"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="edit-phone">Phone</Label>
        <Input
          id="edit-phone"
          type="tel"
          value={form.phone}
          onChange={(e) => update("phone", e.target.value)}
          disabled={disabled}
          maxLength={32}
          placeholder="+91 98xxxxxxxx"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="edit-interest">Interest</Label>
          <Input
            id="edit-interest"
            value={form.interest}
            onChange={(e) => update("interest", e.target.value)}
            disabled={disabled}
            maxLength={500}
            placeholder="Pro plan"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="edit-customer-type">Customer type</Label>
          <Input
            id="edit-customer-type"
            value={form.customer_status}
            onChange={(e) => update("customer_status", e.target.value)}
            disabled={disabled}
            maxLength={50}
            placeholder="Buyer / Owner / …"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label>Intent</Label>
          <Select
            value={form.lead_intent === "" ? "none" : form.lead_intent}
            onValueChange={(v) =>
              update("lead_intent", v === "none" ? "" : (v as LeadIntent))
            }
            disabled={disabled}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Unset</SelectItem>
              <SelectItem value="hot">Hot</SelectItem>
              <SelectItem value="warm">Warm</SelectItem>
              <SelectItem value="cold">Cold</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Wants WhatsApp</Label>
          <Select
            value={form.wants_to_connect_on_watsapp}
            onValueChange={(v) =>
              update(
                "wants_to_connect_on_watsapp",
                v as EditForm["wants_to_connect_on_watsapp"],
              )
            }
            disabled={disabled}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unknown">Unknown</SelectItem>
              <SelectItem value="yes">Yes</SelectItem>
              <SelectItem value="no">No</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="edit-city">City</Label>
          <Input
            id="edit-city"
            value={form.city}
            onChange={(e) => update("city", e.target.value)}
            disabled={disabled}
            maxLength={100}
            placeholder="Mumbai"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="edit-pincode">Pincode</Label>
          <Input
            id="edit-pincode"
            value={form.pincode}
            onChange={(e) => update("pincode", e.target.value)}
            disabled={disabled}
            maxLength={20}
            inputMode="numeric"
            placeholder="400001"
          />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="edit-notes">Notes</Label>
        <Textarea
          id="edit-notes"
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
          disabled={disabled}
          maxLength={5000}
          rows={4}
          placeholder="Conversation context, objections, preferences…"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="edit-visit">Visit scheduled</Label>
        <Input
          id="edit-visit"
          type="datetime-local"
          value={form.visit_date_time}
          onChange={(e) => update("visit_date_time", e.target.value)}
          disabled={disabled}
        />
        <p className="text-[11px] text-muted-foreground">
          Leave blank to clear.
        </p>
      </div>
    </div>
  );
}
