import { describe, expect, it } from "vitest";

import { humaniseFieldKey, transcriptEmptyCopy } from "@/lib/calls/labels";

describe("humaniseFieldKey", () => {
  it("expands snake_case", () => {
    expect(humaniseFieldKey("visit_scheduled_at")).toBe("Visit Scheduled At");
  });

  // The clause a second copy of this helper was missing, so the same key read
  // differently depending on which panel you were looking at.
  it("splits camelCase and PascalCase", () => {
    expect(humaniseFieldKey("leadIntent")).toBe("Lead Intent");
    expect(humaniseFieldKey("LeadIntent")).toBe("Lead Intent");
    expect(humaniseFieldKey("cartTotal2")).toBe("Cart Total2");
  });

  it("handles kebab-case and mixed separators", () => {
    expect(humaniseFieldKey("connect-on_whatsapp")).toBe("Connect On Whatsapp");
  });

  it("collapses repeated separators rather than emitting blank words", () => {
    expect(humaniseFieldKey("a__b")).toBe("A B");
    expect(humaniseFieldKey("")).toBe("");
  });
});

describe("transcriptEmptyCopy", () => {
  // The point of selecting transcript_status at all: "still processing" and
  // "none was produced" mean very different things to someone waiting.
  it("distinguishes in-progress from never-happening", () => {
    expect(transcriptEmptyCopy("processing")).toContain("being processed");
    expect(transcriptEmptyCopy("skipped")).toContain("No transcript was produced");
    expect(transcriptEmptyCopy("failed")).toContain("couldn't fetch");
    expect(transcriptEmptyCopy("ready")).toContain("no utterances");
  });

  it("falls back for unknown or absent status", () => {
    expect(transcriptEmptyCopy(null)).toBe("No transcript to show.");
    expect(transcriptEmptyCopy(undefined)).toBe("No transcript to show.");
    expect(transcriptEmptyCopy("something-new")).toBe("No transcript to show.");
  });
});
