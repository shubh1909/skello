import { describe, expect, it } from "vitest";

import {
  coerceCallOutcome,
  extractLead,
  normalizeOutcomeKey,
  pickValue,
  toBoolean,
  toTimestamp,
  type BolnaField,
} from "@/lib/bolna/extract";

function field(subjective?: unknown, objective?: unknown): BolnaField {
  return { subjective, objective } as BolnaField;
}

describe("pickValue", () => {
  it("prefers subjective over objective", () => {
    expect(pickValue(field("sub", "obj"))).toBe("sub");
  });

  it("falls back to objective when subjective is empty/absent", () => {
    expect(pickValue(field("", "obj"))).toBe("obj");
    expect(pickValue(field(undefined, "obj"))).toBe("obj");
    expect(pickValue(field(null, "obj"))).toBe("obj");
  });

  it("stringifies non-string scalars", () => {
    expect(pickValue(field(42))).toBe("42");
    expect(pickValue(field(true))).toBe("true");
  });

  it("returns null for missing field or both-empty", () => {
    expect(pickValue(undefined)).toBeNull();
    expect(pickValue(field("   ", "   "))).toBeNull();
    expect(pickValue(field(null, null))).toBeNull();
  });
});

describe("toBoolean", () => {
  it.each([
    ["true", true],
    ["yes", true],
    ["1", true],
    ["false", false],
    ["no", false],
    ["0", false],
    ["YES", true],
    ["No", false],
  ] as [string, boolean][])("%s → %s", (input, expected) => {
    expect(toBoolean(input)).toBe(expected);
  });

  it("returns null for null or unrecognised", () => {
    expect(toBoolean(null)).toBeNull();
    expect(toBoolean("maybe")).toBeNull();
  });
});

describe("toTimestamp", () => {
  it("normalises a parseable date to ISO UTC", () => {
    expect(toTimestamp("2026-06-08T10:00:00Z")).toBe("2026-06-08T10:00:00.000Z");
  });

  it("returns null for null or unparseable", () => {
    expect(toTimestamp(null)).toBeNull();
    expect(toTimestamp("not a date")).toBeNull();
  });

  it("interprets a naive (timezone-less) spoken time in the app zone, not UTC", () => {
    // Agents emit local wall-clock times. With the default IST zone, 15:00
    // local must store as 09:30 UTC — not 15:00 UTC (the +5:30 shift bug that
    // made callbacks fire late). Assumes APP_DEFAULT_TIMEZONE is unset (IST).
    expect(toTimestamp("2026-06-24T15:00:00")).toBe("2026-06-24T09:30:00.000Z");
  });
});

describe("normalizeOutcomeKey", () => {
  it("trims, lowercases, and collapses non-alphanumerics to underscores", () => {
    expect(normalizeOutcomeKey("  Call me later! ")).toBe("call_me_later");
    expect(normalizeOutcomeKey("Demo Scheduled")).toBe("demo_scheduled");
    expect(normalizeOutcomeKey("NOT_INTERESTED")).toBe("not_interested");
    expect(normalizeOutcomeKey("--weird__key--")).toBe("weird_key");
  });
});

describe("coerceCallOutcome", () => {
  it("passes through canonical default values", () => {
    for (const v of [
      "interested",
      "meeting_booked",
      "not_interested",
      "callback_requested",
      "do_not_call",
      "wrong_number",
      "no_decision",
    ]) {
      expect(coerceCallOutcome(v)).toBe(v);
    }
  });

  it("is case-insensitive and trims", () => {
    expect(coerceCallOutcome("  Interested  ")).toBe("interested");
    expect(coerceCallOutcome("DO_NOT_CALL")).toBe("do_not_call");
  });

  it("maps common spoken/spacey variants of the defaults", () => {
    expect(coerceCallOutcome("call me later")).toBe("callback_requested");
    expect(coerceCallOutcome("call_back")).toBe("callback_requested");
    expect(coerceCallOutcome("not interested")).toBe("not_interested");
    expect(coerceCallOutcome("do not call")).toBe("do_not_call");
    expect(coerceCallOutcome("wrong number")).toBe("wrong_number");
    expect(coerceCallOutcome("meeting booked")).toBe("meeting_booked");
    expect(coerceCallOutcome("dnc")).toBe("do_not_call");
  });

  it("passes CUSTOM labels through as normalised keys (org policy decides them)", () => {
    expect(coerceCallOutcome("Demo Scheduled")).toBe("demo_scheduled");
    expect(coerceCallOutcome("send brochure")).toBe("send_brochure");
    expect(coerceCallOutcome("blah blah")).toBe("blah_blah");
  });

  it("returns null for null/empty", () => {
    expect(coerceCallOutcome(null)).toBeNull();
    expect(coerceCallOutcome("   ")).toBeNull();
  });
});

describe("extractLead — outcome fields", () => {
  it("reads call_outcome + callback_at from lead_data", () => {
    const result = extractLead({
      call_outcome: field("callback_requested"),
      callback_at: field("2026-07-01T09:00:00Z"),
    });
    expect(result.call_outcome).toBe("callback_requested");
    expect(result.requested_callback_at).toBe("2026-07-01T09:00:00.000Z");
  });

  it("leaves outcome null when absent", () => {
    const result = extractLead({ name: field("Asha") });
    expect(result.call_outcome).toBeNull();
    expect(result.requested_callback_at).toBeNull();
  });
});
