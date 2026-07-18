import { describe, expect, it } from "vitest";

import {
  classifyWhatsAppError,
  terminalStatusFor,
} from "@/lib/whatsapp/error-codes";
import { mapKwikEngageStatus, parseKwikEngageWebhook } from "./webhook";

describe("mapKwikEngageStatus", () => {
  it("normalises known statuses", () => {
    expect(mapKwikEngageStatus("SENT")).toBe("sent");
    expect(mapKwikEngageStatus("delivered")).toBe("delivered");
    expect(mapKwikEngageStatus("Read")).toBe("read");
    expect(mapKwikEngageStatus("undelivered")).toBe("failed");
  });

  it("returns null for unknown / empty", () => {
    expect(mapKwikEngageStatus("typing")).toBeNull();
    expect(mapKwikEngageStatus(null)).toBeNull();
  });
});

describe("parseKwikEngageWebhook", () => {
  it("reads a flat payload", () => {
    expect(
      parseKwikEngageWebhook({ message_id: "wamid.1", status: "delivered" }),
    ).toEqual({
      providerMessageId: "wamid.1",
      status: "delivered",
      errorMessage: null,
      errorCode: null,
    });
  });

  it("reads a nested data payload", () => {
    expect(
      parseKwikEngageWebhook({
        data: { messageId: "wamid.3", state: "read" },
      }),
    ).toEqual({
      providerMessageId: "wamid.3",
      status: "read",
      errorMessage: null,
      errorCode: null,
    });
  });

  it("ignores payloads with no id or no mappable status", () => {
    expect(parseKwikEngageWebhook({ status: "delivered" })).toBeNull();
    expect(parseKwikEngageWebhook({ message_id: "x", status: "typing" })).toBeNull();
    expect(parseKwikEngageWebhook(null)).toBeNull();
  });
});

// KwikEngage's REAL payloads, copied verbatim from production logs. Not Meta's
// documented shape — the BSP wraps it, flattens it, and namespaces the code. We
// built against the docs first and every one of these returned errorCode: null.
describe("parseKwikEngageWebhook — KwikEngage's real payloads", () => {
  it("reads a delivered event", () => {
    expect(
      parseKwikEngageWebhook({
        messageId: "6a5a2d54f5a4f896d76b934b",
        status: "delivered",
        timestamp: 1784294746,
      }),
    ).toEqual({
      providerMessageId: "6a5a2d54f5a4f896d76b934b",
      status: "delivered",
      errorMessage: null,
      errorCode: null,
    });
  });

  it("maps their 'accepted' to our 'sent'", () => {
    expect(
      parseKwikEngageWebhook({
        messageId: "6a5a2d54f5a4f896d76b934b",
        status: "accepted",
        timestamp: 1784294745,
      })?.status,
    ).toBe("sent");
  });

  // The payload that exposed the bug. Three encodings of one code, none of them
  // a plain numeric `error_code`.
  const realFailure = {
    error_code: "whatsapp::error::131049",
    error_reason:
      "(#131049) Delivery restricted due to Meta's Marketing Message Limit",
    messageId: "6a5a2d6895362d0648d0fc3f",
    meta_error_code: "131049",
    status: "failed",
    timestamp: 1784294764,
  };

  it("extracts the code from meta_error_code", () => {
    expect(parseKwikEngageWebhook(realFailure)?.errorCode).toBe(131049);
  });

  it("reads the reason from error_reason", () => {
    expect(parseKwikEngageWebhook(realFailure)?.errorMessage).toBe(
      "(#131049) Delivery restricted due to Meta's Marketing Message Limit",
    );
  });

  it("does not double-prefix a reason that already carries (#code)", () => {
    expect(parseKwikEngageWebhook(realFailure)?.errorMessage).not.toContain(
      "(#131049) (#131049)",
    );
  });

  it("classifies end-to-end as a marketing cap, not a red failure", () => {
    const parsed = parseKwikEngageWebhook(realFailure)!;
    const info = classifyWhatsAppError(parsed.errorMessage, parsed.errorCode);
    expect(info.disposition).toBe("capped");
    expect(info.reason).toBe("marketing_cap");
    // Capped is the shopper's own limit — not something to retry or alarm on.
    expect(terminalStatusFor(info.disposition)).toBe("skipped");
  });

  it("digs the code out of the namespaced error_code alone", () => {
    // Defensive: if meta_error_code ever goes missing, the namespaced string is
    // still the only other place the number exists.
    expect(
      parseKwikEngageWebhook({
        messageId: "x",
        status: "failed",
        error_code: "whatsapp::error::132001",
      })?.errorCode,
    ).toBe(132001);
  });

  it("survives a failure with no code anywhere", () => {
    const parsed = parseKwikEngageWebhook({
      messageId: "x",
      status: "failed",
      error_reason: "something went wrong",
    });
    expect(parsed?.errorCode).toBeNull();
    expect(parsed?.errorMessage).toBe("something went wrong");
  });
});

// The shape that actually matters. Meta sends failures as an ARRAY OF OBJECTS
// under `errors` — not a string under `error`. The old parser looked only for
// strings, so every real rejection lost its code and collapsed into a generic
// "Delivery failed", leaving classifyWhatsAppError with nothing to work with.
describe("parseKwikEngageWebhook — Meta's real failure shape", () => {
  const metaFailure = {
    statuses: [
      {
        id: "wamid.HBgMOTE5OTYyMDA0NDA2",
        status: "failed",
        errors: [
          {
            code: 131049,
            title:
              "This message was not delivered to maintain healthy ecosystem engagement.",
            error_data: { details: "Failed to send message." },
          },
        ],
      },
    ],
  };

  it("extracts the numeric error code", () => {
    expect(parseKwikEngageWebhook(metaFailure)?.errorCode).toBe(131049);
  });

  it("renders the error into the (#code) form classifyWhatsAppError parses", () => {
    const parsed = parseKwikEngageWebhook(metaFailure);
    expect(parsed?.errorMessage).toContain("(#131049)");
    expect(parsed?.errorMessage).toContain("healthy ecosystem engagement");
    expect(parsed?.errorMessage).toContain("Failed to send message.");
  });

  it("still reads the id and status", () => {
    const parsed = parseKwikEngageWebhook(metaFailure);
    expect(parsed?.providerMessageId).toBe("wamid.HBgMOTE5OTYyMDA0NDA2");
    expect(parsed?.status).toBe("failed");
  });

  it("handles an errors[] entry with no error_data", () => {
    const parsed = parseKwikEngageWebhook({
      statuses: [
        {
          id: "wamid.9",
          status: "failed",
          errors: [{ code: 132001, title: "Template name does not exist" }],
        },
      ],
    });
    expect(parsed?.errorCode).toBe(132001);
    expect(parsed?.errorMessage).toBe("(#132001) Template name does not exist");
  });

  it("handles a code with no title at all", () => {
    const parsed = parseKwikEngageWebhook({
      statuses: [{ id: "wamid.10", status: "failed", errors: [{ code: 131026 }] }],
    });
    expect(parsed?.errorCode).toBe(131026);
    expect(parsed?.errorMessage).toBe("(#131026)");
  });

  it("coerces a string code", () => {
    const parsed = parseKwikEngageWebhook({
      statuses: [
        { id: "wamid.11", status: "failed", errors: [{ code: "131047" }] },
      ],
    });
    expect(parsed?.errorCode).toBe(131047);
  });

  it("reads a single error OBJECT (not wrapped in an array)", () => {
    const parsed = parseKwikEngageWebhook({
      message_id: "abc",
      status: "failed",
      error: { code: 131049, title: "capped" },
    });
    expect(parsed?.errorCode).toBe(131049);
    expect(parsed?.errorMessage).toBe("(#131049) capped");
  });

  it("still supports a plain string error (back-compat)", () => {
    const parsed = parseKwikEngageWebhook({
      statuses: [{ id: "wamid.2", status: "failed", error: "blocked" }],
    });
    expect(parsed?.errorMessage).toBe("blocked");
    expect(parsed?.errorCode).toBeNull();
  });

  it("pairs a sibling numeric code with a string error", () => {
    const parsed = parseKwikEngageWebhook({
      message_id: "abc",
      status: "failed",
      error: "Template not found",
      error_code: 132001,
    });
    expect(parsed?.errorCode).toBe(132001);
    expect(parsed?.errorMessage).toBe("(#132001) Template not found");
  });

  it("does not double-prefix a code already present in the text", () => {
    const parsed = parseKwikEngageWebhook({
      message_id: "abc",
      status: "failed",
      error: "(#131049) capped",
      error_code: 131049,
    });
    expect(parsed?.errorMessage).toBe("(#131049) capped");
  });
});
