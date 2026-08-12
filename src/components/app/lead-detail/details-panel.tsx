"use client";

import * as React from "react";
import {
  CheckIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PencilIcon,
  XIcon,
} from "lucide-react";

import { CapturedFieldGroups } from "@/components/app/call-detail";
import { LeadFieldLock } from "@/components/app/lead-field-lock";
import { SectionLabel } from "@/components/app/section-label";
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
import { humaniseFieldKey } from "@/lib/format/keys";
import { formatDateTime, formatRelative } from "@/lib/format";
import {
  LEAD_DATA_SURFACED,
  buildCustomFieldGroups,
  pickLeadDataExtras,
} from "@/lib/leads/captured-fields";
import type { CapturedForm } from "@/lib/leads/captured-form";
import { INTENT_LABEL, INTENT_VARIANT } from "@/lib/leads/intent";
import type { EditForm } from "@/lib/leads/lead-form";
import type { Lead, LeadIntent } from "@/types/lead";
import type { LeadFieldDefinition } from "@/types/lead-field-definition";

/**
 * The Details tab — everything about the lead that is editable, plus the field
 * locks that stop the agent overwriting a human correction.
 *
 * Split out of the sheet when the AI Summary tab took over the read-first view.
 * Editing needed somewhere to live that wasn't competing with a layout designed
 * to be skimmed, and the summary panel needed to stay free of a Save button.
 */
export function LeadDetailsPanel({
  lead,
  editableCatalog,
  effectiveLeadData,
  effectiveCustomData,
  draft,
  onDraftDetails,
  onDraftCaptured,
  onStartEdit,
  onCancel,
  onSave,
  saving,
  error,
  now,
}: {
  lead: Lead;
  editableCatalog: LeadFieldDefinition[];
  effectiveLeadData: Record<string, unknown> | null;
  effectiveCustomData: Record<string, Record<string, unknown>> | null;
  draft: { details: EditForm; captured: CapturedForm } | null;
  onDraftDetails: (next: EditForm) => void;
  onDraftCaptured: (next: CapturedForm) => void;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
  now: number | null;
}) {
  const intent = lead.current_intent ?? lead.lead_intent ?? "cold";
  const hasPhone = Boolean(lead.phone);
  // Extras = everything in lead_data + custom_data not already surfaced in the
  // list below. Drives whether the "Captured fields" section renders at all.
  const leadDataExtras = pickLeadDataExtras(effectiveLeadData, LEAD_DATA_SURFACED);
  const leadFieldGroups = buildCustomFieldGroups(
    effectiveCustomData,
    leadDataExtras,
  );

  return (
    <>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionLabel as="h3">Details</SectionLabel>
          {draft ? null : (
            <Button variant="outline" size="xs" onClick={onStartEdit}>
              <PencilIcon />
              Edit
            </Button>
          )}
        </div>

        {draft ? (
          <LeadEditForm
            form={draft.details}
            onChange={onDraftDetails}
            disabled={saving}
          />
        ) : (
          // Boxed rather than floating on the panel background: the tab is a
          // long run of label/value pairs, and a card edge is what tells the
          // eye where the lead's own fields stop and the captured ones start.
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 rounded-lg border border-border/70 bg-card p-4 text-sm shadow-xs">
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
                <span className="italic text-muted-foreground">No phone</span>
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
              label="Intent score"
              leadId={lead.id}
              fieldPath="current_intent_score"
              value={lead.current_intent_score}
            >
              {/* `!= null` rather than a truthy test: 0 is the coldest real
                  score, and a falsy check would render it as "never scored". */}
              {lead.current_intent_score != null ? (
                <span className="tabular-nums">
                  {lead.current_intent_score}
                  <span className="text-muted-foreground"> / 100</span>
                </span>
              ) : (
                <Muted>Not scored</Muted>
              )}
            </FieldWithLock>
            <Field label="Owner">
              {lead.owner_label ?? <Muted>Unassigned</Muted>}
            </Field>
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
              {lead.wants_to_connect_on_watsapp === true ? (
                "Yes"
              ) : lead.wants_to_connect_on_watsapp === false ? (
                "No"
              ) : (
                <Muted>Unknown</Muted>
              )}
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
            {lead.notes ? (
              <>
                <dt className="col-span-2 pt-1 text-xs text-muted-foreground">
                  Description
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
            <SectionLabel as="h3">Captured fields</SectionLabel>
            {draft && editableCatalog.length > 0 ? (
              <CapturedFieldsEditForm
                fields={editableCatalog}
                form={draft.captured}
                onChange={onDraftCaptured}
                disabled={saving}
              />
            ) : leadFieldGroups.length > 0 ? (
              <CapturedFieldGroups groups={leadFieldGroups} />
            ) : (
              <p className="rounded-md border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
                No fields captured yet. Use Edit to add values.
              </p>
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
          scroller. Sticky inside the scrolling content rather than a persistent
          footer: the bar only exists while editing. The negative margins bleed
          it past the panel's own p-4 so it sits flush against the sheet edge. */}
      {draft ? (
        <div className="sticky bottom-0 -mx-4 -mb-4 mt-auto flex items-center justify-end gap-2 border-t bg-popover/95 px-4 py-3 backdrop-blur-sm">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
            <XIcon /> Cancel
          </Button>
          <Button size="sm" onClick={onSave} disabled={saving}>
            {saving ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      ) : null}
    </>
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

// Field row with a lock indicator. The lock widget fetches its own state from
// lead_field_overrides; the field renders normally regardless.
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

// ---------------------------------------------------------------------------
// Captured fields edit form — catalog-driven inline editor for the lead's
// JSONB-backed fields (lead_data + custom_data). Each catalog row maps to one
// typed input. Keys the Details form already owns are excluded upstream by
// pickEditableCatalog, so nothing appears twice.
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

  // Group by category so nested custom_data fields visually cluster under their
  // group header, matching the read-only display.
  const groups = React.useMemo(() => {
    const map = new Map<string, LeadFieldDefinition[]>();
    for (const def of fields) {
      const key = def.source_column === "lead_data" ? "" : (def.category ?? "");
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
// (summary, actionable, recording_url) are immutable snapshots and are not
// editable here.
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
            placeholder="3 BHK"
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
        <Label htmlFor="edit-notes">Description</Label>
        <Textarea
          id="edit-notes"
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
          disabled={disabled}
          maxLength={5000}
          rows={4}
          placeholder="Standing context on this lead. Day-to-day observations belong in Notes."
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
        <p className="text-[11px] text-muted-foreground">Leave blank to clear.</p>
      </div>
    </div>
  );
}
