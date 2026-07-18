import { describe, expect, it } from "vitest";

import {
  computeOutreachChips,
  type Chip,
  type OutreachInput,
} from "@/components/app/recovery-badges";

// Defaults = a live, unremarkable cart: voice waiting, no WhatsApp yet.
function input(over: Partial<OutreachInput> = {}): OutreachInput {
  return {
    voiceStatus: "pending",
    voiceLastStatus: null,
    voiceSkipReason: null,
    voiceNextAttemptAt: null,
    whatsappStatus: "none",
    whatsappSkipReason: null,
    whatsappError: null,
    whatsappDelivery: null,
    whatsappNextAt: null,
    clickedAt: null,
    convertedAt: null,
    ...over,
  };
}

function byIcon(chips: Chip[], icon: "call" | "whatsapp"): Chip | undefined {
  return chips.find((c) => c.icon === icon);
}

describe("computeOutreachChips — the red problem this replaced", () => {
  // The whole reason for the rework: reaching by phone while WhatsApp errors used
  // to paint the row red. Now the call chip stays green and only WhatsApp is rose.
  it("does not red the call chip when the call reached but WhatsApp failed", () => {
    const chips = computeOutreachChips(
      input({
        voiceStatus: "succeeded",
        whatsappStatus: "failed",
        whatsappError: "(#132001) Template name does not exist",
      }),
    );
    expect(byIcon(chips, "call")).toMatchObject({ label: "Reached", tone: "good" });
    expect(byIcon(chips, "whatsapp")).toMatchObject({
      label: "Template",
      tone: "attention",
    });
  });

  it("keeps rose ONLY for fixable errors, never for customer-side misses", () => {
    // A no-answer must never be rose. (Alone it's amber via the non-contact
    // emphasis; the invariant here is simply: not the alarm colour.)
    const noAnswer = computeOutreachChips(
      input({ voiceStatus: "failed", voiceLastStatus: "no_answer" }),
    );
    expect(byIcon(noAnswer, "call")?.label).toBe("No answer");
    expect(byIcon(noAnswer, "call")?.tone).not.toBe("attention");

    const capped = computeOutreachChips(
      input({ whatsappStatus: "skipped", whatsappSkipReason: "marketing_cap" }),
    );
    expect(byIcon(capped, "whatsapp")).toMatchObject({
      label: "Capped",
      tone: "waiting",
    });
    expect(byIcon(capped, "whatsapp")?.tone).not.toBe("attention");
  });
});

describe("computeOutreachChips — call channel", () => {
  it.each([
    ["succeeded", null, "Reached", "good"],
    ["in_flight", null, "Calling", "active"],
    ["pending", null, "Waiting", "waiting"],
    ["failed", "no_answer", "No answer", "soft"],
    ["failed", "busy", "Busy", "soft"],
    ["failed", null, "Call failed", "attention"],
  ] as const)(
    "%s/%s → %s (%s)",
    (voiceStatus, voiceLastStatus, label, tone) => {
      // Keep WhatsApp in motion so the total-non-contact emphasis (which would
      // bump a lone soft miss to amber) doesn't mask the raw call mapping.
      const chips = computeOutreachChips(
        input({ voiceStatus, voiceLastStatus, whatsappStatus: "in_flight" }),
      );
      expect(byIcon(chips, "call")).toMatchObject({ label, tone });
    },
  );

  it("hides the call chip on a WhatsApp-only cart", () => {
    // Voice sits pending with skip_reason 'no_voice_agent' forever — showing it
    // as "Waiting" would be a lie.
    const chips = computeOutreachChips(
      input({
        voiceStatus: "pending",
        voiceSkipReason: "no_voice_agent",
        whatsappStatus: "sent",
        whatsappDelivery: "delivered",
      }),
    );
    expect(byIcon(chips, "call")).toBeUndefined();
    expect(byIcon(chips, "whatsapp")).toMatchObject({ label: "Delivered" });
  });
});

describe("computeOutreachChips — WhatsApp channel", () => {
  it("clicked outranks every other state", () => {
    const chips = computeOutreachChips(
      input({
        whatsappStatus: "sent",
        whatsappDelivery: "read",
        clickedAt: "2026-07-18T10:00:00Z",
      }),
    );
    expect(byIcon(chips, "whatsapp")).toMatchObject({
      label: "Clicked",
      tone: "good",
    });
  });

  it("reflects Meta's delivery signal, not just our send track", () => {
    expect(
      byIcon(
        computeOutreachChips(
          input({ whatsappStatus: "sent", whatsappDelivery: "read" }),
        ),
        "whatsapp",
      ),
    ).toMatchObject({ label: "Read", tone: "good" });

    expect(
      byIcon(
        computeOutreachChips(input({ whatsappStatus: "sent", whatsappDelivery: null })),
        "whatsapp",
      ),
    ).toMatchObject({ label: "Sent", tone: "active" });
  });

  it("treats an unset template as fixable, opt-out as soft", () => {
    expect(
      byIcon(
        computeOutreachChips(
          input({ whatsappStatus: "skipped", whatsappSkipReason: "no_template" }),
        ),
        "whatsapp",
      ),
    ).toMatchObject({ label: "No template", tone: "attention" });

    expect(
      byIcon(
        computeOutreachChips(
          input({ whatsappStatus: "skipped", whatsappSkipReason: "opted_out" }),
        ),
        "whatsapp",
      ),
    ).toMatchObject({ tone: "soft" });
  });
});

describe("computeOutreachChips — total non-contact emphasis", () => {
  it("bumps both soft misses to amber when the cart reached nobody and is done", () => {
    const chips = computeOutreachChips(
      input({
        voiceStatus: "failed",
        voiceLastStatus: "no_answer",
        whatsappStatus: "skipped",
        whatsappSkipReason: "opted_out",
      }),
    );
    // Neither reached, nothing in motion → the dead cart stands out amber, not red.
    expect(byIcon(chips, "call")).toMatchObject({ tone: "waiting" });
    expect(byIcon(chips, "whatsapp")).toMatchObject({ tone: "waiting" });
    expect(chips.every((c) => c.tone !== "attention")).toBe(true);
  });

  it("does NOT bump when a channel is still in motion", () => {
    const chips = computeOutreachChips(
      input({
        voiceStatus: "failed",
        voiceLastStatus: "no_answer",
        whatsappStatus: "pending", // still queued → not 'all done'
      }),
    );
    expect(byIcon(chips, "call")).toMatchObject({ tone: "soft" });
  });

  it("does NOT bump when one channel actually reached the customer", () => {
    const chips = computeOutreachChips(
      input({
        voiceStatus: "failed",
        voiceLastStatus: "no_answer",
        whatsappStatus: "sent",
        whatsappDelivery: "delivered",
      }),
    );
    // Delivered = contact made, so the no-answer stays a plain soft miss.
    expect(byIcon(chips, "call")).toMatchObject({ tone: "soft" });
    expect(byIcon(chips, "whatsapp")).toMatchObject({ label: "Delivered" });
  });

  it("bumps a lone voice-only no-answer to amber (it reached nobody)", () => {
    // A voice-only cart that got no answer and has no other channel IS a total
    // non-contact — it should stand out amber, not sit quiet slate.
    const chips = computeOutreachChips(
      input({ voiceStatus: "failed", voiceLastStatus: "no_answer" }),
    );
    expect(chips).toHaveLength(1);
    expect(byIcon(chips, "call")).toMatchObject({
      label: "No answer",
      tone: "waiting",
    });
  });

  it("returns no chips when neither channel applies", () => {
    expect(
      computeOutreachChips(
        input({ voiceStatus: "skipped", whatsappStatus: "none" }),
      ),
    ).toHaveLength(0);
  });
});

describe("computeOutreachChips — converted → Bought", () => {
  it("collapses a converted cart to one Bought chip, not two 'Stopped'", () => {
    // On conversion both channels get `canceled`; the old output read
    // "Stopped · Stopped" — a win disguised as a dead cart.
    const chips = computeOutreachChips(
      input({
        voiceStatus: "canceled",
        whatsappStatus: "canceled",
        convertedAt: "2026-07-18T10:00:00Z",
      }),
    );
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ icon: "bought", label: "Bought", tone: "good" });
  });

  it("shows Bought even for an organic conversion (bought before we reached them)", () => {
    const chips = computeOutreachChips(
      input({
        voiceStatus: "failed",
        voiceLastStatus: "no_answer",
        whatsappStatus: "sent",
        convertedAt: "2026-07-18T10:00:00Z",
      }),
    );
    expect(chips).toEqual([{ icon: "bought", label: "Bought", tone: "good" }]);
  });
});

describe("computeOutreachChips — per-lead cap → Capped", () => {
  it("shows the voice cap as Capped instead of hiding the call chip", () => {
    const chips = computeOutreachChips(
      input({ voiceStatus: "skipped", voiceSkipReason: "per_lead_cap_reached" }),
    );
    expect(byIcon(chips, "call")).toMatchObject({
      label: "Capped",
      tone: "waiting",
    });
  });

  it("shows a WhatsApp cap-cancel as Capped, not a bare Stopped", () => {
    const chips = computeOutreachChips(
      input({
        whatsappStatus: "canceled",
        whatsappSkipReason: "per_lead_cap_reached",
      }),
    );
    expect(byIcon(chips, "whatsapp")).toMatchObject({
      label: "Capped",
      tone: "waiting",
    });
  });

  it("a plain WhatsApp cancel (no cap reason) stays Stopped", () => {
    const chips = computeOutreachChips(
      input({ whatsappStatus: "canceled", whatsappSkipReason: null }),
    );
    expect(byIcon(chips, "whatsapp")).toMatchObject({
      label: "Stopped",
      tone: "soft",
    });
  });
});

describe("computeOutreachChips — scheduled time carried through", () => {
  it("attaches the next-attempt time to a waiting call chip", () => {
    const chips = computeOutreachChips(
      input({ voiceStatus: "pending", voiceNextAttemptAt: "2026-07-18T15:40:00Z" }),
    );
    expect(byIcon(chips, "call")).toMatchObject({
      label: "Waiting",
      scheduledAt: "2026-07-18T15:40:00Z",
    });
  });

  it("attaches WhatsApp's own next-send time to a queued chip", () => {
    const chips = computeOutreachChips(
      input({
        voiceStatus: "succeeded", // keep call out of it
        whatsappStatus: "pending",
        whatsappNextAt: "2026-07-18T16:10:00Z",
      }),
    );
    expect(byIcon(chips, "whatsapp")).toMatchObject({
      label: "Queued",
      scheduledAt: "2026-07-18T16:10:00Z",
    });
  });
});
