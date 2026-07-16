import { describe, expect, it } from "vitest";

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
