import {
  fromLocalDateTimeInput,
  toLocalDateTimeInputValue,
} from "@/lib/format";
import type { Lead, LeadIntent, LeadSource, LeadStatus } from "@/types/lead";

/**
 * The lead-level edit form: shape, seed and diff.
 *
 * Only fields that live on the lead row. Per-call fields (summary, actionable,
 * recording_url) are immutable snapshots and are not editable from here.
 * Everything the voice agent extracts is catalog-driven and lives in
 * `captured-form.ts` instead.
 */
export interface EditForm {
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

export type LeadPatch = {
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

// Every field is a string in the form, because that is what an <input> holds.
// Tri-state values become sentinel strings so "unknown" survives a round trip —
// with a boolean, "no" and "not asked" would collapse into the same falsy value.
export function leadToForm(lead: Lead): EditForm {
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

/**
 * Only what actually changed.
 *
 * A patch of every field would be a write amplification problem (and would
 * clobber a concurrent edit to a field this user never touched), so each key is
 * compared against the lead and omitted when equal. Blank strings normalise to
 * `null` so clearing a field is a real change rather than `"" !== null` noise.
 */
export function diffForm(form: EditForm, lead: Lead): LeadPatch {
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

  // Both sides go through ISO before comparing: the form holds a local
  // "YYYY-MM-DDTHH:mm" with no zone, so a raw string compare against a
  // timestamptz would report a change on every save.
  const nextVisitIso = form.visit_date_time
    ? fromLocalDateTimeInput(form.visit_date_time)
    : null;
  const currentVisitIso = lead.visit_date_time
    ? new Date(lead.visit_date_time).toISOString()
    : null;
  if (nextVisitIso !== currentVisitIso) patch.visit_date_time = nextVisitIso;

  return patch;
}
