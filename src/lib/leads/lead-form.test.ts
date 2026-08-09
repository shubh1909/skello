import { describe, expect, it } from "vitest";

import { diffForm, leadToForm, type EditForm } from "./lead-form";
import type { Lead } from "@/types/lead";

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    organisation_id: "org-1",
    org_slug: "acme",
    phone: "+919876543210",
    phone_normalized: "9876543210",
    first_seen_at: null,
    last_contact_at: null,
    name: "Asha Rao",
    current_intent: "warm",
    city: "Pune",
    pincode: null,
    notes: null,
    status: "new",
    pending_action: false,
    source: "inbound_call",
    lead_data: {},
    custom_data: {},
    lead_intent: "warm",
    interest: "Sedan",
    customer_status: null,
    wants_to_connect_on_watsapp: null,
    visit_date_time: null,
    summary: null,
    ...overrides,
  } as Lead;
}

describe("leadToForm", () => {
  it("renders every field as a string, so an input can hold it", () => {
    const form = leadToForm(makeLead());
    for (const value of Object.values(form)) {
      expect(typeof value).toBe("string");
    }
  });

  it("maps a null WhatsApp preference to 'unknown', not 'no'", () => {
    expect(leadToForm(makeLead()).wants_to_connect_on_watsapp).toBe("unknown");
    expect(
      leadToForm(makeLead({ wants_to_connect_on_watsapp: false }))
        .wants_to_connect_on_watsapp,
    ).toBe("no");
  });

  it("maps a null source to the 'none' sentinel", () => {
    expect(leadToForm(makeLead({ source: null })).source).toBe("none");
  });
});

describe("diffForm", () => {
  it("is empty for an untouched form — the round trip is lossless", () => {
    const lead = makeLead();
    expect(diffForm(leadToForm(lead), lead)).toEqual({});
  });

  it("is empty for an untouched form with every optional field null", () => {
    const lead = makeLead({
      name: null,
      phone: null,
      city: null,
      pincode: null,
      notes: null,
      current_intent: null,
      source: null,
      interest: null,
      customer_status: null,
    });
    expect(diffForm(leadToForm(lead), lead)).toEqual({});
  });

  it("returns only the changed key", () => {
    const lead = makeLead();
    const form: EditForm = { ...leadToForm(lead), city: "Mumbai" };
    expect(diffForm(form, lead)).toEqual({ city: "Mumbai" });
  });

  it("normalises a cleared field to null rather than an empty string", () => {
    const lead = makeLead();
    const form: EditForm = { ...leadToForm(lead), notes: "", city: "  " };
    expect(diffForm(form, lead)).toEqual({ city: null });
  });

  it("maps the intent field onto current_intent", () => {
    const lead = makeLead();
    const form: EditForm = { ...leadToForm(lead), lead_intent: "hot" };
    expect(diffForm(form, lead)).toEqual({ current_intent: "hot" });
  });

  it("distinguishes 'no' from 'unknown' for the WhatsApp preference", () => {
    const lead = makeLead({ wants_to_connect_on_watsapp: null });
    const form: EditForm = {
      ...leadToForm(lead),
      wants_to_connect_on_watsapp: "no",
    };
    expect(diffForm(form, lead)).toEqual({
      wants_to_connect_on_watsapp: false,
    });
  });

  // The form holds a zone-less local string; a raw compare would report a
  // change on every single save.
  it("does not report a visit change when the time is untouched", () => {
    const lead = makeLead({ visit_date_time: "2026-03-04T09:30:00.000Z" });
    expect(diffForm(leadToForm(lead), lead)).toEqual({});
  });

  it("clears the visit time when the input is emptied", () => {
    const lead = makeLead({ visit_date_time: "2026-03-04T09:30:00.000Z" });
    const form: EditForm = { ...leadToForm(lead), visit_date_time: "" };
    expect(diffForm(form, lead)).toEqual({ visit_date_time: null });
  });
});
