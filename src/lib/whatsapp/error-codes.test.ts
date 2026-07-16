import { describe, expect, it } from "vitest";

import {
  classifyWhatsAppError,
  terminalStatusFor,
} from "@/lib/whatsapp/error-codes";

describe("classifyWhatsAppError — structured code", () => {
  // The bug this closes: Meta sends the code as a NUMBER in errors[].code, never
  // inlined as "(#131049)" in prose. The regex path therefore never fired on a
  // real delivery webhook, and every Meta rejection — cap, template, opt-out —
  // collapsed into the same "unknown". The whole CODE_MAP was dead on that path.
  it("classifies from a code with no text at all", () => {
    expect(classifyWhatsAppError(null, 131049)).toEqual({
      disposition: "capped",
      code: 131049,
      reason: "marketing_cap",
    });
  });

  it("prefers the structured code over the prose", () => {
    // Provider text that would keyword-match "template" — the code wins.
    const info = classifyWhatsAppError("template something went wrong", 131049);
    expect(info.disposition).toBe("capped");
    expect(info.reason).toBe("marketing_cap");
  });

  it("keeps an unmapped code so the failure stays diagnosable", () => {
    const info = classifyWhatsAppError(null, 999999);
    expect(info.code).toBe(999999);
    expect(info.disposition).toBe("unknown");
  });

  it("distinguishes a per-user cap from a broken template", () => {
    // The distinction that matters operationally: one needs no action, the other
    // means the channel is dead until someone fixes it.
    expect(terminalStatusFor(classifyWhatsAppError(null, 131049).disposition)).toBe(
      "skipped",
    );
    expect(terminalStatusFor(classifyWhatsAppError(null, 132001).disposition)).toBe(
      "failed",
    );
  });

  it("marks a rate limit as retryable, not terminal", () => {
    expect(terminalStatusFor(classifyWhatsAppError(null, 131048).disposition)).toBeNull();
  });

  it("still parses an inlined (#code) when that's all we get", () => {
    const info = classifyWhatsAppError("(#132001) Template name does not exist");
    expect(info.code).toBe(132001);
    expect(info.reason).toBe("template_not_found");
  });

  it("falls back to keywords when there is no code anywhere", () => {
    expect(classifyWhatsAppError("user stopped receiving marketing").reason).toBe(
      "opted_out",
    );
  });

  it("returns unknown for genuinely empty input", () => {
    expect(classifyWhatsAppError(null)).toEqual({
      disposition: "unknown",
      code: null,
      reason: "unknown",
    });
  });
});
