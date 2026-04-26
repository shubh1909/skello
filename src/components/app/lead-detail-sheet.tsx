"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  BellPlusIcon,
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  FileTextIcon,
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
import { CallTranscriptDialog } from "@/components/app/call-transcript-dialog";
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
import { updateLead } from "@/actions/leads";
import {
  formatDateTime,
  formatRelative,
  fromLocalDateTimeInput,
  initialsOf,
  toLocalDateTimeInputValue,
} from "@/lib/format";
import { useClientNow } from "@/hooks/use-client-now";
import type { Lead, LeadIntent, LeadSource, LeadStatus } from "@/types/lead";
import type { Reminder } from "@/types/reminder";
import type { Call, CallStatus } from "@/types/call";

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

const SOURCE_LABEL: Record<LeadSource, string> = {
  inbound_call: "Inbound call",
  whatsapp: "WhatsApp",
  manual: "Manual",
  import: "Import",
  web_form: "Web form",
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
  const [reminders, setReminders] = React.useState<Reminder[] | null>(null);
  const [calls, setCalls] = React.useState<Call[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<EditForm | null>(null);
  const [saving, startSaveTransition] = React.useTransition();
  const now = useClientNow();

  const leadId = lead?.id ?? null;
  const editing = form !== null;

  // Reset edit state whenever a different lead is opened or the sheet closes.
  React.useEffect(() => {
    setForm(null);
  }, [leadId, open]);

  React.useEffect(() => {
    if (!open || !leadId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setReminders(null);
    setCalls(null);
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
          limit: 20,
          offset: 0,
        }),
      ]);
      if (cancelled) return;
      if (!remindersResult.success) setError(remindersResult.error);
      else setReminders(remindersResult.data.items);
      if (!callsResult.success) setError(callsResult.error);
      else setCalls(callsResult.data.items);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, leadId, organisationId]);

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

  if (!lead) return null;

  const intent = lead.lead_intent ?? "cold";
  const contacted = Boolean(lead.contacted_on_watsapp);
  const hasPhone = Boolean(lead.phone);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md md:max-w-lg">
        <SheetHeader className="gap-3 border-b border-border/60 p-5 pr-12">
          <div className="flex items-start gap-3">
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
                <Badge variant={STATUS_VARIANT[lead.status]}>
                  {STATUS_LABEL[lead.status]}
                </Badge>
                <Badge variant={INTENT_VARIANT[intent]}>
                  {INTENT_LABEL[intent]}
                </Badge>
                <Badge
                  render={
                    <button
                      type="button"
                      onClick={() => onToggleContacted(lead)}
                      disabled={pending}
                      aria-pressed={contacted}
                      className="disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  }
                  variant={contacted ? "secondary" : "outline"}
                >
                  <CheckIcon />
                  {contacted ? "Contacted" : "Mark contacted"}
                </Badge>
                {lead.external_id ? (
                  <Badge
                    variant="outline"
                    className="font-mono text-[10px] text-muted-foreground"
                    title="Capture ID from voice agent"
                  >
                    {lead.external_id.slice(0, 10)}
                    {lead.external_id.length > 10 ? "…" : ""}
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 space-y-5 px-5 pb-5">
          {/* Primary actions */}
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

          {/* Contact + details */}
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
                <Field label="Name">
                  {lead.name ?? <Muted>Unnamed</Muted>}
                </Field>
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
                <Field label="Product">
                  {lead.product ?? <Muted>—</Muted>}
                </Field>
                <Field label="Status">
                  <Badge variant={STATUS_VARIANT[lead.status]}>
                    {STATUS_LABEL[lead.status]}
                  </Badge>
                </Field>
                <Field label="Intent">
                  <Badge variant={INTENT_VARIANT[intent]}>
                    {INTENT_LABEL[intent]}
                  </Badge>
                </Field>
                <Field label="Source">
                  {lead.source ? (
                    <Badge variant="outline">{SOURCE_LABEL[lead.source]}</Badge>
                  ) : (
                    <Muted>Unknown</Muted>
                  )}
                </Field>
                <Field label="Customer type">
                  {lead.customer_status ?? <Muted>—</Muted>}
                </Field>
                <Field label="City">
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
                </Field>
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
                <Field label="Created">
                  <span suppressHydrationWarning>
                    {now === null ? "" : formatRelative(lead.created_at, now)}
                  </span>
                </Field>
                <Field label="Updated">
                  <span suppressHydrationWarning>
                    {now === null ? "" : formatRelative(lead.updated_at, now)}
                  </span>
                </Field>
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

          <Separator />

          {/* Reminders */}
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

          {/* Call history */}
          <section className="space-y-3">
            <SectionTitle>Call history</SectionTitle>
            {loading && calls === null ? (
              <Skeleton />
            ) : calls && calls.length > 0 ? (
              <ul className="space-y-2">
                {calls.slice(0, 8).map((c) => (
                  <CallRow key={c.id} call={c} now={now} />
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

function CallRow({ call, now }: { call: Call; now: number | null }) {
  const [open, setOpen] = React.useState(false);
  const duration =
    typeof call.duration_seconds === "number"
      ? formatDuration(call.duration_seconds)
      : null;
  const inbound = call.direction === "inbound";
  const DirectionIcon = inbound ? PhoneIncomingIcon : PhoneOutgoingIcon;
  const counterparty = inbound ? call.from_phone : call.to_phone;
  const hasTranscript = call.transcript_status === "ready";
  return (
    <>
      <li className="flex items-start gap-2 rounded-md border border-border/60 bg-card px-3 py-2">
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
        {hasTranscript ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setOpen(true)}
            aria-label="View transcript"
            title="View transcript"
          >
            <FileTextIcon />
          </Button>
        ) : null}
        <Badge variant={CALL_STATUS_VARIANT[call.status]} className="mt-0.5">
          {CALL_STATUS_LABEL[call.status]}
        </Badge>
      </li>
      <CallTranscriptDialog
        call={call}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

// ---------------------------------------------------------------------------
// Edit mode
// ---------------------------------------------------------------------------

interface EditForm {
  name: string;
  phone: string;
  product: string;
  customer_status: string;
  lead_intent: LeadIntent | "";
  status: LeadStatus;
  source: LeadSource | "none";
  city: string;
  pincode: string;
  notes: string;
  visit_date_time: string; // datetime-local value (YYYY-MM-DDTHH:mm), or ""
  wants_to_connect_on_watsapp: "yes" | "no" | "unknown";
}

function leadToForm(lead: Lead): EditForm {
  return {
    name: lead.name ?? "",
    phone: lead.phone ?? "",
    product: lead.product ?? "",
    customer_status: lead.customer_status ?? "",
    lead_intent: (lead.lead_intent ?? "") as LeadIntent | "",
    status: lead.status,
    source: lead.source ?? "none",
    city: lead.city ?? "",
    pincode: lead.pincode ?? "",
    notes: lead.notes ?? "",
    visit_date_time: lead.visit_date_time
      ? toLocalDateTimeInputValue(lead.visit_date_time)
      : "",
    wants_to_connect_on_watsapp:
      lead.wants_to_connect_on_watsapp === true
        ? "yes"
        : lead.wants_to_connect_on_watsapp === false
          ? "no"
          : "unknown",
  };
}

type LeadPatch = {
  name?: string | null;
  phone?: string | null;
  product?: string | null;
  customer_status?: string | null;
  lead_intent?: LeadIntent | null;
  status?: LeadStatus;
  source?: LeadSource | null;
  city?: string | null;
  pincode?: string | null;
  notes?: string | null;
  visit_date_time?: string | null;
  wants_to_connect_on_watsapp?: boolean | null;
};

function diffForm(form: EditForm, lead: Lead): LeadPatch {
  const patch: LeadPatch = {};
  const nextName = form.name.trim() || null;
  if (nextName !== (lead.name ?? null)) patch.name = nextName;

  const nextPhone = form.phone.trim() || null;
  if (nextPhone !== (lead.phone ?? null)) patch.phone = nextPhone;

  const nextProduct = form.product.trim() || null;
  if (nextProduct !== (lead.product ?? null)) patch.product = nextProduct;

  const nextStatus = form.customer_status.trim() || null;
  if (nextStatus !== (lead.customer_status ?? null)) {
    patch.customer_status = nextStatus;
  }

  const nextIntent = (form.lead_intent || null) as LeadIntent | null;
  if (nextIntent !== (lead.lead_intent ?? null)) patch.lead_intent = nextIntent;

  if (form.status !== lead.status) patch.status = form.status;

  const nextSource = form.source === "none" ? null : form.source;
  if (nextSource !== (lead.source ?? null)) patch.source = nextSource;

  const nextCity = form.city.trim() || null;
  if (nextCity !== (lead.city ?? null)) patch.city = nextCity;

  const nextPincode = form.pincode.trim() || null;
  if (nextPincode !== (lead.pincode ?? null)) patch.pincode = nextPincode;

  const nextNotes = form.notes.trim() || null;
  if (nextNotes !== (lead.notes ?? null)) patch.notes = nextNotes;

  const nextVisitIso = form.visit_date_time
    ? fromLocalDateTimeInput(form.visit_date_time)
    : null;
  const currentVisitIso = lead.visit_date_time
    ? new Date(lead.visit_date_time).toISOString()
    : null;
  if (nextVisitIso !== currentVisitIso) {
    patch.visit_date_time = nextVisitIso;
  }

  const nextWants =
    form.wants_to_connect_on_watsapp === "yes"
      ? true
      : form.wants_to_connect_on_watsapp === "no"
        ? false
        : null;
  if (nextWants !== (lead.wants_to_connect_on_watsapp ?? null)) {
    patch.wants_to_connect_on_watsapp = nextWants;
  }

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
          <Label htmlFor="edit-product">Product</Label>
          <Input
            id="edit-product"
            value={form.product}
            onChange={(e) => update("product", e.target.value)}
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
          <Label>Status</Label>
          <Select
            value={form.status}
            onValueChange={(v) => update("status", v as LeadStatus)}
            disabled={disabled}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="contacted">Contacted</SelectItem>
              <SelectItem value="qualified">Qualified</SelectItem>
              <SelectItem value="negotiating">Negotiating</SelectItem>
              <SelectItem value="won">Won</SelectItem>
              <SelectItem value="lost">Lost</SelectItem>
            </SelectContent>
          </Select>
        </div>
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
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label>Source</Label>
          <Select
            value={form.source}
            onValueChange={(v) =>
              update("source", v as EditForm["source"])
            }
            disabled={disabled}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Unknown</SelectItem>
              <SelectItem value="inbound_call">Inbound call</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="web_form">Web form</SelectItem>
              <SelectItem value="import">Import</SelectItem>
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
        <Label htmlFor="edit-visit">Visit</Label>
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
