import { describe, expect, it } from "vitest";

import { formatDurationClock, formatDurationCompact } from "./duration";

describe("formatDurationCompact", () => {
  it("stays in seconds under a minute", () => {
    expect(formatDurationCompact(45)).toBe("45s");
    expect(formatDurationCompact(0)).toBe("0s");
  });

  // The disagreement between the old copies: some rendered "3m 0s".
  it("drops a zero seconds remainder", () => {
    expect(formatDurationCompact(180)).toBe("3m");
    expect(formatDurationCompact(200)).toBe("3m 20s");
  });

  // No previous copy handled this: a 92-minute call rendered "92m 14s".
  it("rolls over into hours", () => {
    expect(formatDurationCompact(5534)).toBe("1h 32m");
    expect(formatDurationCompact(3600)).toBe("1h");
  });

  it("treats null, NaN and negatives as empty", () => {
    expect(formatDurationCompact(null)).toBe("—");
    expect(formatDurationCompact(undefined)).toBe("—");
    expect(formatDurationCompact(Number.NaN)).toBe("—");
    expect(formatDurationCompact(-5)).toBe("—");
  });

  it("lets the call site choose what empty looks like", () => {
    expect(formatDurationCompact(null, { empty: "0s" })).toBe("0s");
  });
});

describe("formatDurationClock", () => {
  it("pads seconds so a column aligns", () => {
    expect(formatDurationClock(45)).toBe("0:45");
    expect(formatDurationClock(200)).toBe("3:20");
    expect(formatDurationClock(605)).toBe("10:05");
  });

  it("switches to hours and minutes past the hour", () => {
    expect(formatDurationClock(5534)).toBe("1h 32m");
    expect(formatDurationClock(3660)).toBe("1h 01m");
  });

  it("honours the stat-card convention of 0:00 over an em dash", () => {
    expect(formatDurationClock(null)).toBe("—");
    expect(formatDurationClock(null, { empty: "0:00" })).toBe("0:00");
  });
});
