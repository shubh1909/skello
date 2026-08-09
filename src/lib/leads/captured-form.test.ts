import { describe, expect, it } from "vitest";

import {
  buildCapturedForm,
  diffCapturedForm,
  isCapturedPatchEmpty,
  pickEditableCatalog,
  readCatalogValue,
} from "./captured-form";
import type {
  LeadFieldDataType,
  LeadFieldDefinition,
  LeadFieldSource,
} from "@/types/lead-field-definition";

function def(
  id: string,
  source_column: LeadFieldSource,
  key_path: string,
  category = "",
  data_type: LeadFieldDataType = "string",
  display_order = 0,
): LeadFieldDefinition {
  return {
    id,
    organisation_id: "org-1",
    source_column,
    category,
    key_path,
    label: null,
    data_type,
    visible_in_table: true,
    filterable: false,
    sortable: false,
    searchable: false,
    display_order,
    sample_value: null,
    enum_options: null,
    last_seen_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("pickEditableCatalog", () => {
  it("drops real table columns — the details form owns those", () => {
    const out = pickEditableCatalog([
      def("a", "column", "current_intent"),
      def("b", "lead_data", "budget"),
    ]);
    expect(out.map((d) => d.id)).toEqual(["b"]);
  });

  // Without this the same field renders twice and both copies write the key.
  it("drops the lead_data keys the details form already edits", () => {
    const out = pickEditableCatalog([
      def("a", "lead_data", "interest"),
      def("b", "lead_data", "customer_status"),
      def("c", "lead_data", "connect_on_whatsapp"),
      def("d", "lead_data", "date_and_time_of_visit"),
      def("e", "lead_data", "budget"),
    ]);
    expect(out.map((d) => d.id)).toEqual(["e"]);
  });

  it("keeps a custom_data field even when its key matches a details key", () => {
    const out = pickEditableCatalog([def("a", "custom_data", "interest", "car")]);
    expect(out.map((d) => d.id)).toEqual(["a"]);
  });

  it("orders by category, then display_order, then label", () => {
    const out = pickEditableCatalog([
      def("z", "custom_data", "z", "finance", "string", 1),
      def("a", "lead_data", "a", "", "string", 2),
      def("y", "custom_data", "y", "finance", "string", 0),
    ]);
    expect(out.map((d) => d.id)).toEqual(["a", "y", "z"]);
  });

  it("does not mutate the caller's array", () => {
    const input = [
      def("b", "lead_data", "b", "", "string", 1),
      def("a", "lead_data", "a", "", "string", 0),
    ];
    pickEditableCatalog(input);
    expect(input.map((d) => d.id)).toEqual(["b", "a"]);
  });
});

describe("readCatalogValue", () => {
  it("reads a flat ungrouped custom_data scalar", () => {
    expect(
      readCatalogValue(def("a", "custom_data", "colour"), null, {
        colour: "white",
      }),
    ).toBe("white");
  });

  // Otherwise a key colliding with a category name hands back a whole bag.
  it("refuses an object when the category is ungrouped", () => {
    expect(
      readCatalogValue(def("a", "custom_data", "vehicle"), null, {
        vehicle: { model: "i20" },
      }),
    ).toBeNull();
  });

  it("reads through a named category", () => {
    expect(
      readCatalogValue(def("a", "custom_data", "model", "vehicle"), null, {
        vehicle: { model: "i20" },
      }),
    ).toBe("i20");
  });
});

describe("buildCapturedForm", () => {
  const fields = [
    def("a", "lead_data", "budget"),
    def("b", "custom_data", "model", "vehicle"),
  ];

  it("seeds from the lead row", () => {
    expect(
      buildCapturedForm(fields, { budget: "12L" }, { vehicle: { model: "i20" } }),
    ).toEqual({ a: "12L", b: "i20" });
  });

  it("falls back to the backfilled view only where the lead row is empty", () => {
    expect(
      buildCapturedForm(
        fields,
        { budget: "12L" },
        null,
        { budget: "9L" },
        { vehicle: { model: "i20" } },
      ),
    ).toEqual({ a: "12L", b: "i20" });
  });

  it("coerces a word boolean to the radio's value", () => {
    const boolField = [def("c", "lead_data", "test_drive", "", "boolean")];
    expect(buildCapturedForm(boolField, { test_drive: "yes" }, null)).toEqual({
      c: "true",
    });
    expect(buildCapturedForm(boolField, { test_drive: false }, null)).toEqual({
      c: "false",
    });
    expect(buildCapturedForm(boolField, { test_drive: "maybe" }, null)).toEqual({
      c: "",
    });
  });
});

describe("diffCapturedForm", () => {
  const lead = { lead_data: { budget: "12L" }, custom_data: {} };

  it("is empty for an untouched form", () => {
    const fields = [def("a", "lead_data", "budget")];
    const form = buildCapturedForm(fields, lead.lead_data, lead.custom_data);
    expect(isCapturedPatchEmpty(diffCapturedForm(form, fields, lead))).toBe(
      true,
    );
  });

  it("routes a lead_data field and a custom_data field to their own patches", () => {
    const fields = [
      def("a", "lead_data", "budget"),
      def("b", "custom_data", "model", "vehicle"),
    ];
    const patch = diffCapturedForm({ a: "15L", b: "i20" }, fields, lead);
    expect(patch).toEqual({
      lead_data_patch: { budget: "15L" },
      custom_data_patch: { vehicle: { model: "i20" } },
    });
  });

  it("sends null for a cleared field, which the server treats as a delete", () => {
    const fields = [def("a", "lead_data", "budget")];
    expect(diffCapturedForm({ a: "  " }, fields, lead)).toEqual({
      lead_data_patch: { budget: null },
    });
  });

  // A stored "yes" and a form "true" are the same answer.
  it("does not report a change when only the spelling differs", () => {
    const fields = [def("c", "lead_data", "test_drive", "", "boolean")];
    const stored = { lead_data: { test_drive: "yes" }, custom_data: {} };
    expect(
      isCapturedPatchEmpty(diffCapturedForm({ c: "true" }, fields, stored)),
    ).toBe(true);
  });

  // The whole point of the backfill: a value that only ever lived on a call
  // snapshot is a real change against the lead row, so saving promotes it.
  it("promotes a backfilled value onto the lead row", () => {
    const fields = [def("a", "lead_data", "budget")];
    const empty = { lead_data: {}, custom_data: {} };
    const form = buildCapturedForm(fields, null, null, { budget: "12L" }, null);
    expect(diffCapturedForm(form, fields, empty)).toEqual({
      lead_data_patch: { budget: "12L" },
    });
  });

  it("coerces numbers, and refuses a non-numeric string", () => {
    const fields = [def("n", "lead_data", "seats", "", "number")];
    const empty = { lead_data: {}, custom_data: {} };
    expect(diffCapturedForm({ n: "5" }, fields, empty)).toEqual({
      lead_data_patch: { seats: 5 },
    });
    expect(
      isCapturedPatchEmpty(diffCapturedForm({ n: "five" }, fields, empty)),
    ).toBe(true);
  });
});
