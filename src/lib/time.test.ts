import { describe, expect, it } from "vitest";

import { parseProviderTimestamp } from "@/lib/time";

const IST = "Asia/Kolkata"; // UTC+5:30, no DST

describe("parseProviderTimestamp", () => {
  it("returns null for empty input", () => {
    expect(parseProviderTimestamp(null)).toBeNull();
    expect(parseProviderTimestamp(undefined)).toBeNull();
    expect(parseProviderTimestamp("")).toBeNull();
    expect(parseProviderTimestamp("   ")).toBeNull();
  });

  it("returns null for an unparseable string", () => {
    expect(parseProviderTimestamp("not a date")).toBeNull();
  });

  it("trusts an explicit-UTC (Z) timestamp as-is", () => {
    expect(parseProviderTimestamp("2026-06-08T10:00:00Z", IST)).toBe(
      "2026-06-08T10:00:00.000Z",
    );
  });

  it("trusts an explicit ±HH:MM offset as-is", () => {
    // 15:00 +05:30 == 09:30 UTC.
    expect(parseProviderTimestamp("2026-06-24T15:00:00+05:30", IST)).toBe(
      "2026-06-24T09:30:00.000Z",
    );
  });

  it("interprets a naive ISO datetime in the given zone (the bug fix)", () => {
    // 15:00 IST should be 09:30 UTC — NOT 15:00 UTC (the +5:30 shift bug).
    expect(parseProviderTimestamp("2026-06-24T15:00:00", IST)).toBe(
      "2026-06-24T09:30:00.000Z",
    );
  });

  it("interprets a naive space-separated datetime in the given zone", () => {
    expect(parseProviderTimestamp("2026-06-24 15:00:00", IST)).toBe(
      "2026-06-24T09:30:00.000Z",
    );
  });

  it("handles a naive datetime without seconds", () => {
    expect(parseProviderTimestamp("2026-06-24 15:00", IST)).toBe(
      "2026-06-24T09:30:00.000Z",
    );
  });

  it("interprets a date-only value as local midnight", () => {
    // Midnight IST == 18:30 UTC the previous day.
    expect(parseProviderTimestamp("2026-06-24", IST)).toBe(
      "2026-06-23T18:30:00.000Z",
    );
  });

  it("respects a non-IST zone for naive input", () => {
    // 15:00 in New York during DST (EDT, UTC-4) == 19:00 UTC.
    expect(
      parseProviderTimestamp("2026-06-24T15:00:00", "America/New_York"),
    ).toBe("2026-06-24T19:00:00.000Z");
  });
});
