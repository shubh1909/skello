import { describe, expect, it } from "vitest";

import {
  formatBindingValue,
  readBindingValue,
  resolveBinding,
  resolveSlot,
  statsFromCalls,
  type BindingSource,
} from "@/lib/leads/sheet-bindings";
import type { LeadSheetBinding } from "@/types/lead-sheet-binding";

const source: BindingSource = {
  lead: {
    name: "Anjali Sharma",
    phone: "+91 77714 86557",
    city: "Ahmedabad",
    pincode: null,
    notes: null,
    source: "web_form",
    status: "qualified",
    current_intent: "warm",
    current_intent_score: 56,
    owner_label: "Property Expert 2",
    pending_action: false,
    created_at: "2026-08-01T10:00:00.000Z",
    first_seen_at: "2026-08-01T10:00:00.000Z",
    last_contact_at: "2026-08-12T07:33:00.000Z",
  },
  leadData: { interest: "3 BHK", budget: "80 L", intent_score: 56 },
  customData: { general: { location_preference: "Jagatpur" } },
  stats: {
    inbound_calls: 1,
    outbound_calls: 3,
    total_calls: 4,
    last_call_at: "2026-08-12T07:33:00.000Z",
    first_call_at: "2026-08-01T10:05:00.000Z",
    last_call_duration_seconds: 318,
  },
};

function binding(over: Partial<LeadSheetBinding> = {}): LeadSheetBinding {
  return {
    id: "b1",
    organisation_id: "org1",
    slot: "stat_card",
    slot_position: 0,
    label: "Intent",
    source_column: "column",
    category: "",
    key_path: "current_intent",
    caption_source_column: null,
    caption_category: "",
    caption_key_path: null,
    caption_static: null,
    format: "text",
    created_at: "2026-08-12T00:00:00.000Z",
    updated_at: "2026-08-12T00:00:00.000Z",
    ...over,
  };
}

describe("readBindingValue", () => {
  it("reads an allowlisted lead column", () => {
    expect(readBindingValue("column", "", "owner_label", source)).toBe(
      "Property Expert 2",
    );
  });

  it("reads a call-aggregate column", () => {
    expect(readBindingValue("column", "", "outbound_calls", source)).toBe(3);
  });

  // The whole reason COLUMN_READERS is a map and not a property read: key_path
  // is admin-authored text, and a dynamic lookup would happily return internals.
  it("returns undefined for a column that is not on the allowlist", () => {
    expect(
      readBindingValue("column", "", "organisation_id", source),
    ).toBeUndefined();
  });

  it("reads a lead_data key", () => {
    expect(readBindingValue("lead_data", "", "interest", source)).toBe("3 BHK");
  });

  // Live data spells the uncategorised bucket three ways; a binding authored
  // against '' must still find a lead stored under the legacy 'general'.
  it("finds an uncategorised custom_data key under a legacy alias", () => {
    expect(
      readBindingValue("custom_data", "", "location_preference", source),
    ).toBe("Jagatpur");
  });
});

describe("formatBindingValue", () => {
  it("hides absent values but keeps zero", () => {
    expect(formatBindingValue(null, "text")).toBeNull();
    expect(formatBindingValue("   ", "text")).toBeNull();
    expect(formatBindingValue(0, "number")).toBe("0");
  });

  it("renders false as No rather than hiding it", () => {
    expect(formatBindingValue(false, "text")).toBe("No");
  });

  it("formats a numeric budget as rupees", () => {
    expect(formatBindingValue(8000000, "currency_inr")).toContain("80,00,000");
  });

  // Extraction is free text. "80 L" is what the customer said; refusing to show
  // it because it isn't a number would lose the answer entirely.
  it("passes non-numeric currency through untouched", () => {
    expect(formatBindingValue("80 L", "currency_inr")).toBe("80 L");
  });

  it("title-cases enum values for badges", () => {
    // Shared with the outcome-key formatter, which capitalises every word.
    expect(formatBindingValue("callback_requested", "enum_badge")).toBe(
      "Callback Requested",
    );
    expect(formatBindingValue("negotiating", "enum_badge")).toBe("Negotiating");
  });

  it("falls back to the raw string when a date won't parse", () => {
    expect(formatBindingValue("next tuesday", "date")).toBe("next tuesday");
  });
});

describe("resolveBinding", () => {
  it("resolves value and static caption", () => {
    const r = resolveBinding(
      binding({ format: "enum_badge", caption_static: "Lead temperature" }),
      source,
    );
    expect(r).toMatchObject({
      display: "Warm",
      raw: "warm",
      caption: "Lead temperature",
    });
  });

  it("resolves a caption from a second field", () => {
    const r = resolveBinding(
      binding({
        key_path: "current_intent_score",
        format: "number",
        caption_source_column: "lead_data",
        caption_key_path: "interest",
      }),
      source,
    );
    expect(r?.display).toBe("56");
    expect(r?.caption).toBe("3 BHK");
  });

  it("returns null when the field has no value", () => {
    expect(resolveBinding(binding({ key_path: "pincode" }), source)).toBeNull();
  });
});

describe("resolveSlot", () => {
  const bindings = [
    binding({ id: "a", slot_position: 1, key_path: "owner_label" }),
    binding({ id: "b", slot_position: 0, key_path: "current_intent" }),
    binding({ id: "c", slot_position: 2, key_path: "pincode" }),
  ];

  it("orders by position and drops unresolved entries", () => {
    const out = resolveSlot(bindings, "stat_card", source);
    expect(out.map((r) => r.id)).toEqual(["b", "a"]);
  });

  // The card row is a three-column grid. Dropping a card would reflow the
  // other two, which reads as a layout bug rather than as missing data.
  it("keeps a placeholder for the card row", () => {
    const out = resolveSlot(bindings, "stat_card", source, true);
    expect(out.map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(out[2]).toMatchObject({ display: null, label: "Intent" });
  });
});

describe("statsFromCalls", () => {
  it("counts directions and takes duration from the newest call", () => {
    const stats = statsFromCalls([
      { direction: "outbound", started_at: "2026-08-12T07:33:00Z", duration_seconds: 318 },
      { direction: "inbound", started_at: "2026-08-01T10:05:00Z", duration_seconds: 42 },
    ]);
    expect(stats).toEqual({
      inbound_calls: 1,
      outbound_calls: 1,
      total_calls: 2,
      last_call_at: "2026-08-12T07:33:00Z",
      first_call_at: "2026-08-01T10:05:00Z",
      last_call_duration_seconds: 318,
    });
  });

  it("survives calls that never started", () => {
    const stats = statsFromCalls([
      { direction: "outbound", started_at: null, duration_seconds: null },
    ]);
    expect(stats.total_calls).toBe(1);
    expect(stats.last_call_at).toBeNull();
  });
});
