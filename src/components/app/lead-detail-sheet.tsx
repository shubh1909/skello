"use client";

import { humaniseFieldKey } from "@/lib/format/keys";
import { formatDurationCompact } from "@/lib/format/duration";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
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
import {
  CallSplitView,
  CapturedFieldGroups,
} from "@/components/app/call-detail";
import { EntityAvatar } from "@/components/app/entity-avatar";
import { PendingActionBadge } from "@/components/app/pending-action-badge";
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
import { listReminders } from "@/actions/reminders";
import { listCalls } from "@/actions/calls";
import { updateLead } from "@/actions/leads";
import { formatDateTime, formatRelative } from "@/lib/format";
import {
  LEAD_DATA_SURFACED,
  buildCustomFieldGroups,
  pickLeadDataExtras,
} from "@/lib/leads/captured-fields";
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
import { INTENT_LABEL, INTENT_VARIANT } from "@/lib/leads/intent";
import { useClientNow } from "@/hooks/use-client-now";
import type { Lead, LeadIntent } from "@/types/lead";
import type { LeadFieldDefinition } from "@/types/lead-field-definition";
import type { Reminder } from "@/types/reminder";
import type { Call, CallStatus } from "@/types/call";

type LeadTab = "summary" | "calls" | "activity";

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
  lead: Lead | null;
  organisationId: string;
  // Catalog drives the editable form for captured fields — the sheet needs
  // it to know each field's data_type (string / number / boolean / date /
  // enum) and which keys are admin-declared vs. orphan extractions.
  catalog?: LeadFieldDefinition[];
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
  catalog,
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
  const searchParams = useSearchParams();
  const [reminders, setReminders] = React.useState<Reminder[] | null>(null);
  const [calls, setCalls] = React.useState<Call[] | null>(null);
  const [callsTotal, setCallsTotal] = React.useState(0);
  const [callsLoadingMore, setCallsLoadingMore] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // ONE draft for the whole Summary panel.
  //
  // There used to be two independent edit states — one for Details, one for
  // Captured fields — each with its own Edit, Save and Cancel. They didn't know
  // about each other, so both could be open at once with two Save buttons on
  // screen doing different things, and switching from one to the other
  // discarded the first silently. There was never a server reason for the
  // split: `updateLead` takes the row fields and both JSONB patches in a single
  // call, which is exactly what `onSave` now sends.
  const [draft, setDraft] = React.useState<LeadDraft | null>(null);
  const [saving, startSaveTransition] = React.useTransition();
  // Replaces the old `historyMode` boolean. That boolean drove a SECOND full
  // layout at a different sheet width; folding it into a tab means one width,
  // no jump, and no duplicated body.
  //
  // Invariant, enforced by the handlers below:
  //   `?call=<id>` present  ⟺  tab === "calls" && selectedCallId !== null
  const [tab, setTab] = React.useState<LeadTab>("summary");
  const [selectedCallId, setSelectedCallId] = React.useState<string | null>(
    null,
  );
  const now = useClientNow();

  const leadId = lead?.id ?? null;
  const editing = draft !== null;
  const urlCallId = searchParams.get("call");

  // Sync the selected call to the ?call=<id> query param.
  //  - on close, strip it
  //  - on entering history mode via row click, push the selection
  //  - on landing with ?call=<id> already present, switch to history mode and
  //    select the call when its row arrives in the loaded page
  //
  // Use the history API directly instead of router.replace: this is a pure
  // URL serialization of local sheet state, not a navigation. A Next.js soft
  // nav would re-run the leads server component, ship a fresh initialItems
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

  // Hydrate the active tab + selection from the URL on open. We intentionally
  // read the URL only when the sheet opens for a new lead — once inside, the
  // user's interactions drive both selection and URL together via setCallInUrl.
  // (useSearchParams is the SSR-correct source on first paint; it goes stale
  // after replaceState, which is exactly why this is keyed on [open, leadId].)
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

  // Landing on the Calls tab with nothing selected (e.g. clicking the tab
  // directly) defaults to the most recent call.
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
    // so coming back re-selects without a refetch. (The old exitHistory nulled
    // the selection, which meant a round trip every time.)
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
    // Edit lives in the pinned header, so it is reachable from any tab. The
    // forms are on Summary, so go there rather than appearing to do nothing.
    setTab("summary");
    setCallInUrl(null);
  }

  function cancelEdit() {
    setDraft(null);
  }

  /**
   * One save for both halves of the panel.
   *
   * `updateLead` merges the row fields, `lead_data_patch` and
   * `custom_data_patch` in a single statement, so this is one request and one
   * atomic write — not two that could half-fail. The key spaces can't collide:
   * `pickEditableCatalog` excludes every `lead_data` key the details form owns.
   */
  function onSave() {
    if (!lead || !draft) return;

    const detailsPatch = diffForm(draft.details, lead);
    const capturedPatch = diffCapturedForm(
      draft.captured,
      editableCatalog,
      lead,
    );

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

  // ⚠️ The FIRST page only — never the whole paged list.
  //
  // `loadMoreCalls` appends, and the Summary tab's captured fields are derived
  // from this array. Feeding it the full list made Summary grow as you scrolled
  // the Calls tab: open a lead, see 6 fields, scroll the call list, come back
  // to 9. Nothing about the lead had changed.
  //
  // Derived rather than held in its own state: `calls` is only ever set to page
  // one or appended to, so a slice is exactly page one by construction and
  // there is no second variable to keep in sync.
  const backfillCalls = React.useMemo(
    () => calls?.slice(0, CALLS_PAGE_SIZE) ?? null,
    [calls],
  );

  // Plain calls, deliberately not `useMemo`. These are pure functions imported
  // from `lib/`, and the React Compiler can't see across a module boundary to
  // prove that — so a manual memo around one makes it give up on the region
  // ("existing memoization could not be preserved") instead of optimising it.
  // Both are bounded by one page of calls, so recomputing costs nothing.
  const effectiveCustomData = buildEffectiveCustomData(
    lead?.custom_data,
    backfillCalls,
  );
  const effectiveLeadData = buildEffectiveLeadData(
    lead?.lead_data,
    backfillCalls,
  );

  // Read by startEdit, onSave and the render — it was recomputed independently
  // in all three, and the three copies had to agree for a save to be correct.
  const editableCatalog = pickEditableCatalog(catalog ?? []);

  if (!lead) return null;

  const intent = lead.current_intent ?? lead.lead_intent ?? "cold";
  const isPending = Boolean(lead.pending_action);
  const hasPhone = Boolean(lead.phone);
  // Extras = everything in lead_data + custom_data that isn't already
  // surfaced in the Details dl. Drives whether the "Captured fields"
  // section renders at all.
  const leadDataExtras = pickLeadDataExtras(effectiveLeadData, LEAD_DATA_SURFACED);
  const leadFieldGroups = buildCustomFieldGroups(
    effectiveCustomData,
    leadDataExtras,
  );

  return (
    <DetailSheetShell
      open={open}
      onOpenChange={handleOpenChange}
      // ONE width, always. This used to jump 560 -> 1280 when history mode
      // engaged, which is what forced two entire layouts to exist. `lg` fits the
      // Calls tab's rail + pane comfortably and gives Summary room to breathe.
      width="lg"
      title={lead.name ?? "Unnamed lead"}
      description="Lead details and history"
      avatar={
        <EntityAvatar name={lead.name} size="lg" />
      }
      pills={
        <>
          <Badge variant={INTENT_VARIANT[intent]}>{INTENT_LABEL[intent]}</Badge>
          <PendingActionBadge
            pending={isPending}
            disabled={saving || pending}
            onToggle={() => onToggleContacted(lead)}
          />
        </>
      }
      actions={
        <>
          {/* One Edit for the whole lead, pinned in the header rather than
              scrolling away inside a section. Hidden while editing — Save and
              Cancel are in the sticky bar at the foot of the Summary panel, and
              a third, inert Edit button beside them would be noise. */}
          {editing ? null : (
            <Button variant="outline" size="sm" onClick={startEdit}>
              <PencilIcon />
              Edit
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onCall(lead)}
            disabled={pending || !hasPhone}
            title={hasPhone ? "Place a call" : "No phone on file"}
          >
            <PhoneIcon />
            Call
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenReminder(lead)}
          >
            <BellPlusIcon />
            Remind
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
                {/* Delete lived in a persistent SheetFooter, which spent 60px of
                    every viewport making the most destructive action the most
                    prominent thing on screen. */}
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
        { value: "summary", label: "Summary" },
        { value: "calls", label: "Calls", count: callsTotal || undefined },
        { value: "activity", label: "Activity" },
      ]}
      activeTab={tab}
      onTabChange={onTabChange}
    >
      <DetailSheetPanel value="summary">
        {/* The 3-up quick-action grid moved into the shell header, where it is
            pinned instead of scrolling away. */}
          <section className="space-y-3">
            <SectionTitle>Details</SectionTitle>

            {draft ? (
              <LeadEditForm
                form={draft.details}
                onChange={(details) =>
                  setDraft((prev) => (prev ? { ...prev, details } : prev))
                }
                disabled={saving}
              />
            ) : (
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
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

          {leadFieldGroups.length > 0 || editableCatalog.length > 0 ? (
            <>
              <Separator />
              <section className="space-y-3">
                <SectionTitle>Captured fields</SectionTitle>
                {draft && editableCatalog.length > 0 ? (
                  <CapturedFieldsEditForm
                    fields={editableCatalog}
                    form={draft.captured}
                    onChange={(captured) =>
                      setDraft((prev) => (prev ? { ...prev, captured } : prev))
                    }
                    disabled={saving}
                  />
                ) : leadFieldGroups.length > 0 ? (
                  <CapturedFieldGroups groups={leadFieldGroups} />
                ) : (
                  <EmptyHint>
                    No fields captured yet. Use Edit to add values.
                  </EmptyHint>
                )}
              </section>
            </>
          ) : null}

          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive-muted px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}

          {/* One Save/Cancel for the whole panel, pinned to the bottom of the
              scroller. `sticky` inside the scrolling content rather than a
              SheetFooter: the bar only exists while editing, and a permanent
              footer is what used to spend 60px of every viewport on a Delete
              button. The negative margins bleed it past the panel's own p-4 so
              it sits flush against the sheet edge. */}
          {draft ? (
            <div className="sticky bottom-0 -mx-4 -mb-4 mt-auto flex items-center justify-end gap-2 border-t bg-popover/95 px-4 py-3 backdrop-blur-sm">
              <Button
                variant="ghost"
                size="sm"
                onClick={cancelEdit}
                disabled={saving}
              >
                <XIcon /> Cancel
              </Button>
              <Button size="sm" onClick={onSave} disabled={saving}>
                {saving ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <CheckIcon />
                )}
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          ) : null}
      </DetailSheetPanel>

      {/* Calls — what used to be `historyMode`, now just a tab. Same two-pane
          rail + pane, at the sheet's single fixed width. */}
      <DetailSheetPanel value="calls" fill>
        {/* The same rail + pane cart recovery and COD now use. Extracted
            rather than copied — this view existed three times. */}
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

      <DetailSheetPanel value="activity">
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
                  onClick={() => openCalls()}
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
      <dd className="min-w-0 text-sm wrap-break-word">{children}</dd>
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
      <dd className="min-w-0 text-sm wrap-break-word">{children}</dd>
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

// ---------------------------------------------------------------------------
// Captured fields edit form — catalog-driven inline editor for the lead's
// JSONB-backed fields (lead_data + custom_data). Each catalog row maps to
// one typed input. The hardcoded keys below are already editable via the
// main Details form, so the captured-fields editor skips them to avoid
// the same field appearing twice in the sheet.
// ---------------------------------------------------------------------------

function CapturedFieldsEditForm({
  fields,
  form,
  onChange,
  disabled,
}: {
  fields: LeadFieldDefinition[];
  form: CapturedForm;
  onChange: (next: CapturedForm) => void;
  disabled: boolean;
}) {
  function update(id: string, value: string) {
    onChange({ ...form, [id]: value });
  }

  // Group by category so nested custom_data fields visually cluster
  // under their group header, matching the read-only display.
  const groups = React.useMemo(() => {
    const map = new Map<string, LeadFieldDefinition[]>();
    for (const def of fields) {
      const key =
        def.source_column === "lead_data" ? "" : (def.category ?? "");
      const bag = map.get(key) ?? [];
      bag.push(def);
      map.set(key, bag);
    }
    return Array.from(map.entries());
  }, [fields]);

  return (
    <div className="space-y-4">
      {groups.map(([category, defs]) => (
        <div key={category || "_ungrouped"} className="space-y-2">
          {category ? (
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {humaniseFieldKey(category)}
            </div>
          ) : null}
          <div className="grid gap-3 rounded-md border border-border/70 bg-card p-3">
            {defs.map((def) => {
              const inputId = `cap-${def.id}`;
              const label = def.label ?? humaniseFieldKey(def.key_path);
              const value = form[def.id] ?? "";
              return (
                <div key={def.id} className="grid gap-1.5">
                  <Label htmlFor={inputId} className="text-xs">
                    {label}
                  </Label>
                  {def.data_type === "boolean" ? (
                    <Select
                      value={value === "" ? "unset" : value}
                      onValueChange={(v) =>
                        update(def.id, !v || v === "unset" ? "" : v)
                      }
                      disabled={disabled}
                    >
                      <SelectTrigger id={inputId} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unset">Unset</SelectItem>
                        <SelectItem value="true">Yes</SelectItem>
                        <SelectItem value="false">No</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : def.data_type === "enum" &&
                    def.enum_options &&
                    def.enum_options.length > 0 ? (
                    <Select
                      value={value === "" ? "unset" : value}
                      onValueChange={(v) =>
                        update(def.id, !v || v === "unset" ? "" : v)
                      }
                      disabled={disabled}
                    >
                      <SelectTrigger id={inputId} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unset">Unset</SelectItem>
                        {def.enum_options.map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {opt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : def.data_type === "date" ? (
                    <Input
                      id={inputId}
                      type="datetime-local"
                      value={value}
                      onChange={(e) => update(def.id, e.target.value)}
                      disabled={disabled}
                    />
                  ) : def.data_type === "number" ? (
                    <Input
                      id={inputId}
                      type="number"
                      value={value}
                      onChange={(e) => update(def.id, e.target.value)}
                      disabled={disabled}
                      step="any"
                    />
                  ) : (
                    <Input
                      id={inputId}
                      value={value}
                      onChange={(e) => update(def.id, e.target.value)}
                      disabled={disabled}
                      maxLength={2000}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit mode — only fields that live at the lead level. Per-call fields
// (summary, actionable, recording_url, visit_date_time) are immutable
// snapshots and no longer editable from here. Visit time and WhatsApp
// preference moved out of the edit form for the same reason — they're
// LLM-extracted dynamic fields exposed via the catalog UI now.
// ---------------------------------------------------------------------------

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
