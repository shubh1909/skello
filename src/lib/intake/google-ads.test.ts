import { describe, expect, it } from "vitest";

import {
  normaliseGoogleAdsLead,
  parseGoogleAdsPayload,
  sanitiseKey,
} from "./google-ads";

// A realistic body, shaped like Google's published sample.
const SAMPLE = {
  lead_id: "abc-123",
  api_version: "1.0",
  form_id: 1234567,
  campaign_id: 9876543,
  gcl_id: "Cj0KCQ",
  is_test: false,
  google_key: "s3cret",
  lead_submit_time: "2026-08-12T12:30:00Z",
  lead_source: "LEAD_FORM",
  user_column_data: [
    { column_id: "FULL_NAME", string_value: "Asha Menon", column_name: "Full name" },
    { column_id: "PHONE_NUMBER", string_value: "+91 98765 43210" },
    { column_id: "EMAIL", string_value: "asha@example.com" },
    { column_id: "CITY", string_value: "Pune" },
    { column_id: "What is your budget?", string_value: "1.2 Cr" },
  ],
};

describe("parseGoogleAdsPayload", () => {
  it("parses the documented payload shape", () => {
    const parsed = parseGoogleAdsPayload(SAMPLE);
    expect(parsed).not.toBeNull();
    expect(parsed?.lead_id).toBe("abc-123");
    expect(parsed?.user_column_data).toHaveLength(5);
    expect(parsed?.google_key).toBe("s3cret");
    expect(parsed?.is_test).toBe(false);
  });

  it("accepts int64 ids as numbers or strings", () => {
    expect(parseGoogleAdsPayload(SAMPLE)?.form_id).toBe("1234567");
    expect(
      parseGoogleAdsPayload({ ...SAMPLE, form_id: "1234567" })?.form_id,
    ).toBe("1234567");
  });

  it("rejects a body with no lead_id — we could not deduplicate it", () => {
    expect(parseGoogleAdsPayload({ ...SAMPLE, lead_id: undefined })).toBeNull();
    expect(parseGoogleAdsPayload({ ...SAMPLE, lead_id: "  " })).toBeNull();
    expect(parseGoogleAdsPayload(null)).toBeNull();
    expect(parseGoogleAdsPayload("nope")).toBeNull();
    expect(parseGoogleAdsPayload([SAMPLE])).toBeNull();
  });

  it("tolerates unknown top-level fields", () => {
    // Google explicitly reserves the right to add optional fields. A parser
    // that rejected them would break on a non-breaking change.
    const parsed = parseGoogleAdsPayload({ ...SAMPLE, some_future_field: 42 });
    expect(parsed?.lead_id).toBe("abc-123");
  });

  it("drops malformed column entries rather than the whole lead", () => {
    const parsed = parseGoogleAdsPayload({
      ...SAMPLE,
      user_column_data: [
        { column_id: "FULL_NAME", string_value: "Asha" },
        { column_id: "EMPTY", string_value: "   " },
        { string_value: "orphan" },
        null,
        "garbage",
      ],
    });
    expect(parsed?.user_column_data).toHaveLength(1);
  });

  it("treats a missing is_test as production, and only true as a test", () => {
    expect(parseGoogleAdsPayload({ ...SAMPLE, is_test: undefined })?.is_test).toBe(false);
    // A truthy string must not be read as a test lead — that would silently
    // stop creating real leads.
    expect(parseGoogleAdsPayload({ ...SAMPLE, is_test: "true" })?.is_test).toBe(false);
    expect(parseGoogleAdsPayload({ ...SAMPLE, is_test: true })?.is_test).toBe(true);
  });
});

describe("normaliseGoogleAdsLead", () => {
  const parsed = parseGoogleAdsPayload(SAMPLE)!;

  it("maps Google's documented columns onto lead fields", () => {
    const lead = normaliseGoogleAdsLead(parsed);
    expect(lead.name).toBe("Asha Menon");
    expect(lead.phone).toBe("+91 98765 43210");
    expect(lead.city).toBe("Pune");
    expect(lead.source).toBe("google_ads");
    expect(lead.snapshot.lead_data.email).toBe("asha@example.com");
  });

  it("puts unrecognised questions in the uncategorised bucket with a bindable key", () => {
    const lead = normaliseGoogleAdsLead(parsed);
    // Spaces and punctuation would make a key no lead-sheet binding could
    // address, since binding key paths are validated against [A-Za-z0-9_.-].
    expect(lead.snapshot.custom_data[""]).toEqual({
      what_is_your_budget: "1.2 Cr",
    });
  });

  it("keeps ad attribution in its own category", () => {
    const lead = normaliseGoogleAdsLead(parsed);
    expect(lead.snapshot.custom_data.google_ads).toMatchObject({
      lead_id: "abc-123",
      form_id: "1234567",
      campaign_id: "9876543",
      gcl_id: "Cj0KCQ",
      submitted_at: "2026-08-12T12:30:00Z",
    });
  });

  it("omits attribution keys Google did not send", () => {
    const lead = normaliseGoogleAdsLead(parsed);
    expect(lead.snapshot.custom_data.google_ads).not.toHaveProperty("adgroup_id");
  });

  it("stitches first + last when the form has no FULL_NAME", () => {
    const p = parseGoogleAdsPayload({
      ...SAMPLE,
      user_column_data: [
        { column_id: "FIRST_NAME", string_value: "Asha" },
        { column_id: "LAST_NAME", string_value: "Menon" },
      ],
    })!;
    expect(normaliseGoogleAdsLead(p).name).toBe("Asha Menon");
  });

  it("still yields a name when only one part was asked for", () => {
    const p = parseGoogleAdsPayload({
      ...SAMPLE,
      user_column_data: [{ column_id: "LAST_NAME", string_value: "Menon" }],
    })!;
    expect(normaliseGoogleAdsLead(p).name).toBe("Menon");
  });

  it("prefers the personal number over the work number", () => {
    const p = parseGoogleAdsPayload({
      ...SAMPLE,
      user_column_data: [
        { column_id: "PHONE_NUMBER", string_value: "111" },
        { column_id: "WORK_PHONE", string_value: "222" },
      ],
    })!;
    expect(normaliseGoogleAdsLead(p).phone).toBe("111");
  });

  it("returns a null phone rather than inventing one", () => {
    const p = parseGoogleAdsPayload({
      ...SAMPLE,
      user_column_data: [{ column_id: "EMAIL", string_value: "a@b.com" }],
    })!;
    const lead = normaliseGoogleAdsLead(p);
    expect(lead.phone).toBeNull();
    expect(lead.snapshot.lead_data.email).toBe("a@b.com");
  });

  it("lets a field map rename a custom question", () => {
    const lead = normaliseGoogleAdsLead(parsed, {
      "What is your budget?": "budget",
    });
    expect(lead.snapshot.custom_data[""]).toEqual({ budget: "1.2 Cr" });
  });

  it("lets a field map retarget a column onto a lead field", () => {
    const lead = normaliseGoogleAdsLead(parsed, { CITY: "ignore" });
    expect(lead.city).toBeNull();
    expect(lead.snapshot.custom_data[""]).not.toHaveProperty("city");
  });

  it("omits the uncategorised bucket entirely when there is nothing in it", () => {
    const p = parseGoogleAdsPayload({
      ...SAMPLE,
      user_column_data: [{ column_id: "FULL_NAME", string_value: "Asha" }],
    })!;
    const lead = normaliseGoogleAdsLead(p);
    // An empty {} would register no fields but would still be written; keeping
    // it absent means the JSONB merge does strictly nothing.
    //
    // Object.keys, not toHaveProperty(""): Vitest reads the argument as a
    // property PATH, and the empty path resolves to null before it ever looks
    // at the object.
    expect(Object.keys(lead.snapshot.custom_data)).toEqual(["google_ads"]);
  });
});

describe("sanitiseKey", () => {
  it("produces keys a lead-sheet binding can address", () => {
    expect(sanitiseKey("What is your budget?")).toBe("what_is_your_budget");
    expect(sanitiseKey("  Possession   timeline  ")).toBe("possession_timeline");
    expect(sanitiseKey("FULL_NAME")).toBe("full_name");
    expect(sanitiseKey("2BHK / 3BHK")).toBe("2bhk_3bhk");
  });

  it("never returns an empty key", () => {
    expect(sanitiseKey("???")).toBe("field");
    expect(sanitiseKey("")).toBe("field");
  });

  it("bounds the length so a pasted paragraph cannot become a column name", () => {
    expect(sanitiseKey("a".repeat(200))).toHaveLength(60);
  });
});
