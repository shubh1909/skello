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
    });
  });

  it("reads a Meta cloud-style statuses[] payload with an error", () => {
    expect(
      parseKwikEngageWebhook({
        statuses: [{ id: "wamid.2", status: "failed", error: "blocked" }],
      }),
    ).toEqual({
      providerMessageId: "wamid.2",
      status: "failed",
      errorMessage: "blocked",
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
    });
  });

  it("ignores payloads with no id or no mappable status", () => {
    expect(parseKwikEngageWebhook({ status: "delivered" })).toBeNull();
    expect(parseKwikEngageWebhook({ message_id: "x", status: "typing" })).toBeNull();
    expect(parseKwikEngageWebhook(null)).toBeNull();
  });
});
