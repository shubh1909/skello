"use client";

import { formatDurationCompact } from "@/lib/format/duration";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BellPlusIcon,
  ClockIcon,
  HistoryIcon,
  MessageCircleIcon,
  PhoneIcon,
  PhoneIncomingIcon,
  PhoneOutgoingIcon,
  Trash2Icon,
  MoreHorizontalIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DetailSheetPanel,
  DetailSheetShell,
} from "@/components/app/detail-sheet";
import { CallSplitView } from "@/components/app/call-detail";
import { EntityAvatar } from "@/components/app/entity-avatar";
import { PendingActionBadge } from "@/components/app/pending-action-badge";
import { SectionLabel } from "@/components/app/section-label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { AssignCallbackDialog } from "@/components/app/lead-detail/assign-callback-dialog";
import { LeadDetailsPanel } from "@/components/app/lead-detail/details-panel";
import { LeadHeaderControls } from "@/components/app/lead-detail/header-controls";
import { LeadNotesPanel } from "@/components/app/lead-detail/notes-panel";
import { LeadSummaryPanel } from "@/components/app/lead-detail/summary-panel";
import { listReminders } from "@/actions/reminders";
import { listCalls } from "@/actions/calls";
import { updateLead } from "@/actions/leads";
import { formatRelative } from "@/lib/format";
import {
  buildEffectiveCustomData,
  buildEffectiveLeadData,
} from "@/lib/leads/effective-data";
import {
  buildCapturedForm,
  diffCapturedForm,
  isCapturedPatchEmpty,
  pickEditableCatalog,
  type CapturedForm,
} from "@/lib/leads/captured-form";
import {
  diffForm,
  leadToForm,
  type EditForm,
} from "@/lib/leads/lead-form";
import {
  resolveSlot,
  statsFromCalls,
  type BindingSource,
  type LeadCallStats,
} from "@/lib/leads/sheet-bindings";
import { useClientNow } from "@/hooks/use-client-now";
import type { Lead, LeadStatus } from "@/types/lead";
import type { LeadFieldDefinition } from "@/types/lead-field-definition";
import type { LeadSheetBinding } from "@/types/lead-sheet-binding";
import type { Reminder } from "@/types/reminder";
import type { Call, CallStatus } from "@/types/call";

type LeadTab = "summary" | "calls" | "notes" | "details" | "activity";

/**
 * The lead as the leads table has it: a `Lead` plus the call aggregates the
 * `lead_call_activity` RPC returns. The aggregates are optional so any caller
 * holding a plain `Lead` still type-checks — the sheet falls back to counting
 * the calls it loaded.
 */
export interface LeadSheetLead extends Lead {
  inbound_calls?: number;
  outbound_calls?: number;
  total_calls?: number;
  last_call_at?: string | null;
  first_call_at?: string | null;
}

/**
 * The Summary panel's edit draft.
 *
 * Both halves are seeded together and saved together, so they can't disagree
 * about which lead they belong to or be half-committed.
 */
interface LeadDraft {
  details: EditForm;
  captured: CapturedForm;
}

const CALLS_PAGE_SIZE = 20;
const DEFAULT_VISIBLE_CALLS = 8;

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
  lead: LeadSheetLead | null;
  organisationId: string;
  // Catalog drives the editable form for captured fields — the sheet needs it
  // to know each field's data_type (string / number / boolean / date / enum)
  // and which keys are admin-declared vs. orphan extractions. It also carries
  // the curated owner_label options.
  catalog?: LeadFieldDefinition[];
  /**
   * Per-org layout: which fields fill the stat cards, the "what they want"
   * panel and the header meta line. Empty is survivable — every slot hides
   * itself — but orgs are seeded with defaults on migration.
   */
  bindings?: LeadSheetBinding[];
  open: boolean;
  onOpenChange: (next: boolean) => void;
  pending: boolean;
  /** Step to the adjacent row in the table behind the sheet. */
  onPrev?: () => void;
  onNext?: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  onCall: (lead: Lead) => void;
  onOpenWhatsApp: (lead: Lead) => void;
  onOpenReminder: (lead: Lead) => void;
  onToggleContacted: (lead: Lead) => void;
  onDelete: (lead: Lead) => void;
}

export function LeadDetailSheet({
  lead,
  organisationId,
  catalog,
  bindings,
  open,
  onOpenChange,
  pending,
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
  onCall,
  onOpenWhatsApp,
  onOpenReminder,
  onToggleContacted,
  onDelete,
}: LeadDetailSheetProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [reminders, setReminders] = React.useState<Reminder[] | null>(null);
  const [calls, setCalls] = React.useState<Call[] | null>(null);
  const [callsTotal, setCallsTotal] = React.useState(0);
  const [callsLoadingMore, setCallsLoadingMore] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // ONE draft for the whole Details panel. There used to be two independent
  // edit states — one for Details, one for Captured fields — each with its own
  // Edit, Save and Cancel, so both could be open at once with two Save buttons
  // doing different things. `updateLead` takes the row fields and both JSONB
  // patches in a single call, which is exactly what `onSave` sends.
  const [draft, setDraft] = React.useState<LeadDraft | null>(null);
  const [saving, startSaveTransition] = React.useTransition();
  // Header pickers save immediately, so they get their own pending flag —
  // sharing `saving` would grey out the edit form while a status change flies.
  const [quickSaving, startQuickSave] = React.useTransition();
  const [callbackOpen, setCallbackOpen] = React.useState(false);
  // Invariant, enforced by the handlers below:
  //   `?call=<id>` present  ⟺  tab === "calls" && selectedCallId !== null
  const [tab, setTab] = React.useState<LeadTab>("summary");
  const [selectedCallId, setSelectedCallId] = React.useState<string | null>(
    null,
  );
  const now = useClientNow();

  const leadId = lead?.id ?? null;
  const urlCallId = searchParams.get("call");

  // Sync the selected call to the ?call=<id> query param.
  //
  // Use the history API directly instead of router.replace: this is a pure URL
  // serialization of local sheet state, not a navigation. A Next.js soft nav
  // would re-run the leads server component, ship a fresh initialItems
  // reference, and useInfiniteList would clobber the client-filtered rows —
  // making the detail lead disappear and unmounting this sheet mid-click.
  const setCallInUrl = React.useCallback((id: string | null) => {
    if (typeof window === "undefined") return;
    const next = new URLSearchParams(window.location.search);
    if (id) next.set("call", id);
    else next.delete("call");
    const qs = next.toString();
    const url = qs
      ? `${window.location.pathname}?${qs}`
      : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, []);

  React.useEffect(() => {
    setDraft(null);
  }, [leadId, open]);

  // Hydrate the active tab + selection from the URL on open. The URL is read
  // only when the sheet opens for a new lead — once inside, the user's
  // interactions drive both selection and URL together via setCallInUrl.
  React.useEffect(() => {
    if (!open) {
      setTab("summary");
      setSelectedCallId(null);
      return;
    }
    if (urlCallId) {
      setTab("calls");
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

  // Landing on the Calls tab with nothing selected defaults to the most recent.
  React.useEffect(() => {
    if (tab !== "calls") return;
    if (selectedCallId) return;
    if (calls && calls.length > 0) {
      setSelectedCallId(calls[0].id);
    }
  }, [tab, selectedCallId, calls]);

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

  /** Jump to the Calls tab, optionally at a specific call. */
  function openCalls(callId?: string) {
    const target = callId ?? selectedCallId ?? calls?.[0]?.id ?? null;
    setTab("calls");
    if (target) {
      setSelectedCallId(target);
      setCallInUrl(target);
    }
  }

  function onTabChange(next: string) {
    const nextTab = next as LeadTab;
    setTab(nextTab);
    if (nextTab === "calls") {
      // Re-publish the held selection so the URL matches the visible state.
      if (selectedCallId) setCallInUrl(selectedCallId);
      return;
    }
    // Leaving Calls drops the param but KEEPS `selectedCallId` in React state,
    // so coming back re-selects without a refetch.
    setCallInUrl(null);
  }

  function selectCall(id: string) {
    setSelectedCallId(id);
    setCallInUrl(id);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      // Always strip the ?call= param when the sheet closes; otherwise
      // reopening any lead row would silently re-enter the calls tab.
      setCallInUrl(null);
    }
    onOpenChange(next);
  }

  function startEdit() {
    if (!lead) return;
    setDraft({
      details: leadToForm(lead),
      // Prefilled from the lead's own JSONB first, with the call-backfilled
      // view as fallback — see buildCapturedForm for why the lead row is read
      // directly rather than through the effective view.
      captured: buildCapturedForm(
        editableCatalog,
        lead.lead_data ?? null,
        lead.custom_data ?? null,
        effectiveLeadData,
        effectiveCustomData,
      ),
    });
    setError(null);
  }

  function cancelEdit() {
    setDraft(null);
  }

  /**
   * One save for both halves of the Details panel.
   *
   * `updateLead` merges the row fields, `lead_data_patch` and
   * `custom_data_patch` in a single statement, so this is one request and one
   * atomic write — not two that could half-fail. The key spaces can't collide:
   * `pickEditableCatalog` excludes every `lead_data` key the details form owns.
   */
  function onSave() {
    if (!lead || !draft) return;

    const detailsPatch = diffForm(draft.details, lead);
    const capturedPatch = diffCapturedForm(draft.captured, editableCatalog, lead);

    if (
      Object.keys(detailsPatch).length === 0 &&
      isCapturedPatchEmpty(capturedPatch)
    ) {
      toast.info("No changes to save");
      setDraft(null);
      return;
    }

    startSaveTransition(async () => {
      const result = await updateLead(lead.id, {
        ...detailsPatch,
        ...capturedPatch,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Lead updated");
      setDraft(null);
      router.refresh();
    });
  }

  /**
   * The header pickers write straight through.
   *
   * Intent, status and owner are what a salesperson changes mid-call. Routing
   * them through the edit form's open → change → save would be three clicks for
   * a one-word decision, which is how these fields stop being maintained.
   */
  function quickPatch(patch: Record<string, unknown>, label: string) {
    if (!lead) return;
    startQuickSave(async () => {
      const result = await updateLead(lead.id, patch);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(label);
      router.refresh();
    });
  }

  // ⚠️ The FIRST page only — never the whole paged list.
  //
  // `loadMoreCalls` appends, and the summary's captured fields are derived from
  // this array. Feeding it the full list made the summary grow as you scrolled
  // the Calls tab: open a lead, see 6 fields, scroll the call list, come back to
  // 9. Nothing about the lead had changed.
  const backfillCalls = React.useMemo(
    () => calls?.slice(0, CALLS_PAGE_SIZE) ?? null,
    [calls],
  );

  // Plain calls, deliberately not `useMemo`. These are pure functions imported
  // from `lib/`, and the React Compiler can't see across a module boundary to
  // prove that — so a manual memo around one makes it give up on the region
  // instead of optimising it. Both are bounded by one page of calls.
  const effectiveCustomData = buildEffectiveCustomData(
    lead?.custom_data,
    backfillCalls,
  );
  const effectiveLeadData = buildEffectiveLeadData(lead?.lead_data, backfillCalls);

  // Read by startEdit, onSave and the render — it was recomputed independently
  // in all three, and the three copies had to agree for a save to be correct.
  const editableCatalog = pickEditableCatalog(catalog ?? []);

  // Curated by an admin on the lead-fields page; empty until they set it up,
  // which the picker treats as "don't offer an owner control at all".
  const ownerOptions = React.useMemo(
    () =>
      catalog?.find(
        (d) => d.source_column === "column" && d.key_path === "owner_label",
      )?.enum_options ?? [],
    [catalog],
  );

  /**
   * Call aggregates for the "last contact" panel and any `column` binding that
   * points at one.
   *
   * The lead row's own counts win when present: they come from the RPC and
   * cover every call, whereas the loaded array is one page. Only the LAST
   * call's duration has to come from the array — no aggregate carries it — and
   * it is read from page one, which is newest-first, so it doesn't drift as
   * older pages load.
   */
  const callStats: LeadCallStats = React.useMemo(() => {
    const fromPage = statsFromCalls(backfillCalls ?? []);
    return {
      inbound_calls: lead?.inbound_calls ?? fromPage.inbound_calls,
      outbound_calls: lead?.outbound_calls ?? fromPage.outbound_calls,
      total_calls: lead?.total_calls ?? callsTotal ?? fromPage.total_calls,
      last_call_at: lead?.last_call_at ?? fromPage.last_call_at,
      first_call_at: lead?.first_call_at ?? fromPage.first_call_at,
      last_call_duration_seconds: fromPage.last_call_duration_seconds,
    };
  }, [lead, backfillCalls, callsTotal]);

  const bindingSource: BindingSource | null = lead
    ? {
        lead,
        leadData: effectiveLeadData,
        customData: effectiveCustomData,
        stats: callStats,
      }
    : null;

  const allBindings = bindings ?? [];
  // `keepUnresolved` for the cards only: the row is a three-column grid and a
  // card that vanishes reflows the other two, which reads as a layout bug
  // rather than as missing data.
  const statCards = bindingSource
    ? resolveSlot(allBindings, "stat_card", bindingSource, true)
    : [];
  const wants = bindingSource
    ? resolveSlot(allBindings, "wants", bindingSource)
    : [];
  const headerMeta = bindingSource
    ? resolveSlot(allBindings, "header_meta", bindingSource)
    : [];

  if (!lead) return null;

  const isPending = Boolean(lead.pending_action);
  const hasPhone = Boolean(lead.phone);
  const busy = saving || quickSaving || pending;

  return (
    <>
      <DetailSheetShell
        open={open}
        onOpenChange={handleOpenChange}
        // ONE width, always. This used to jump 560 -> 1280 when history mode
        // engaged, which is what forced two entire layouts to exist.
        width="lg"
        onPrev={onPrev}
        onNext={onNext}
        prevDisabled={prevDisabled}
        nextDisabled={nextDisabled}
        navLabel="lead"
        title={lead.name ?? "Unnamed lead"}
        description="Lead details and history"
        avatar={<EntityAvatar name={lead.name} size="lg" />}
        pills={
          <>
            {/* Only the pending toggle stays a badge. Intent and status used to
                sit here as chips AND again as pickers directly below — the same
                word twice, the inert copy first. The pickers now carry the
                colour, so the state still reads at a glance. */}
            <PendingActionBadge
              pending={isPending}
              disabled={busy}
              onToggle={() => onToggleContacted(lead)}
            />
            <LeadHeaderControls
              intent={lead.current_intent}
              status={lead.status}
              ownerLabel={lead.owner_label}
              ownerOptions={ownerOptions}
              meta={headerMeta}
              disabled={busy}
              onIntentChange={(next) =>
                quickPatch({ current_intent: next }, "Intent updated")
              }
              onStatusChange={(next: LeadStatus) =>
                quickPatch({ status: next }, "Status updated")
              }
              onOwnerChange={(next) =>
                quickPatch({ owner_label: next }, "Owner updated")
              }
            />
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onCall(lead)}
              disabled={busy || !hasPhone}
              title={hasPhone ? "Place a call" : "No phone on file"}
            >
              <PhoneIcon />
              Call again
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenWhatsApp(lead)}
              disabled={!hasPhone}
            >
              <MessageCircleIcon />
              WhatsApp
            </Button>
            {/* The primary action, and the only one that gets the filled
                treatment: it is the one that puts work into the machine rather
                than onto the person clicking. */}
            <Button
              size="sm"
              onClick={() => setCallbackOpen(true)}
              disabled={busy || !hasPhone}
              title={
                hasPhone ? "The agent will ring them" : "No phone on file"
              }
            >
              <BellPlusIcon />
              Assign callback
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon-sm" aria-label="More actions" />
                }
              >
                <MoreHorizontalIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => onOpenReminder(lead)}>
                    <BellPlusIcon />
                    Remind me
                  </DropdownMenuItem>
                  {/* Delete lived in a persistent SheetFooter, which spent 60px
                      of every viewport making the most destructive action the
                      most prominent thing on screen. */}
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => onDelete(lead)}
                    disabled={pending}
                  >
                    <Trash2Icon />
                    Delete lead
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
        tabs={[
          { value: "summary", label: "AI Summary" },
          {
            value: "calls",
            label: "Call & Transcript",
            count: callsTotal || undefined,
          },
          { value: "notes", label: "Notes" },
          { value: "details", label: "Details" },
          { value: "activity", label: "Activity" },
        ]}
        activeTab={tab}
        onTabChange={onTabChange}
      >
        <DetailSheetPanel value="summary">
          <LeadSummaryPanel
            cards={statCards}
            wants={wants}
            summary={lead.summary}
            actionable={lead.actionable}
            stats={callStats}
            now={now}
          />
        </DetailSheetPanel>

        {/* Calls — the same rail + pane cart recovery and COD use. */}
        <DetailSheetPanel value="calls" fill>
          <CallSplitView
            calls={calls}
            total={callsTotal}
            selectedId={selectedCallId}
            onSelect={selectCall}
            onLoadMore={loadMoreCalls}
            loadingMore={callsLoadingMore}
            counterpartyName={lead.name}
            now={now}
            emptyLabel="No calls for this lead yet."
          />
        </DetailSheetPanel>

        <DetailSheetPanel value="notes">
          {/* Keyed on the lead so switching leads remounts with empty state
              rather than briefly showing the previous lead's notes. */}
          <LeadNotesPanel
            key={lead.id}
            leadId={lead.id}
            active={tab === "notes"}
            now={now}
          />
        </DetailSheetPanel>

        <DetailSheetPanel value="details">
          <LeadDetailsPanel
            lead={lead}
            editableCatalog={editableCatalog}
            effectiveLeadData={effectiveLeadData}
            effectiveCustomData={effectiveCustomData}
            draft={draft}
            onDraftDetails={(details) =>
              setDraft((prev) => (prev ? { ...prev, details } : prev))
            }
            onDraftCaptured={(captured) =>
              setDraft((prev) => (prev ? { ...prev, captured } : prev))
            }
            onStartEdit={startEdit}
            onCancel={cancelEdit}
            onSave={onSave}
            saving={saving}
            error={error}
            now={now}
          />
        </DetailSheetPanel>

        <DetailSheetPanel value="activity">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <SectionLabel as="h3">Reminders</SectionLabel>
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
              <SectionLabel as="h3">Call history</SectionLabel>
              {callsTotal > 0 ? (
                <Button variant="ghost" size="xs" onClick={() => openCalls()}>
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
                    onSelect={() => openCalls(c.id)}
                  />
                ))}
              </ul>
            ) : (
              <EmptyHint>No calls placed yet.</EmptyHint>
            )}
          </section>
        </DetailSheetPanel>
      </DetailSheetShell>

      <AssignCallbackDialog
        // Remounts when opened, so the default time is always "an hour from
        // now" rather than an hour after the sheet was first rendered.
        key={`${lead.id}-${callbackOpen}`}
        leadId={lead.id}
        leadName={lead.name}
        open={callbackOpen}
        onOpenChange={setCallbackOpen}
        onAssigned={() => router.refresh()}
      />
    </>
  );
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
        {reminder.status === "done" ? "Done" : overdue ? "Overdue" : "Pending"}
      </Badge>
    </li>
  );
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
      ? formatDurationCompact(call.duration_seconds)
      : null;
  const inbound = call.direction === "inbound";
  const DirectionIcon = inbound ? PhoneIncomingIcon : PhoneOutgoingIcon;
  const counterparty = inbound ? call.from_phone : call.to_phone;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-start gap-2 rounded-md border border-border/60 bg-card px-3 py-2 text-left transition-colors hover:bg-accent/40"
      >
        <DirectionIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs tabular-nums">
            {counterparty ?? "Unknown number"}
          </p>
          <p className="text-xs text-muted-foreground" suppressHydrationWarning>
            {now === null || !call.started_at
              ? CALL_STATUS_LABEL[call.status]
              : `${formatRelative(call.started_at, now)}${
                  duration ? ` · ${duration}` : ""
                }`}
          </p>
        </div>
        <Badge variant={CALL_STATUS_VARIANT[call.status]} className="mt-0.5">
          {CALL_STATUS_LABEL[call.status]}
        </Badge>
      </button>
    </li>
  );
}
