import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  normaliseWhatsAppLead,
  parseWhatsAppWebhook,
  verifyMetaSignature,
} from "./whatsapp";

/** A Cloud API `messages` webhook for a Click-to-WhatsApp first message. */
const CTWA_BODY = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "102290129340398",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "918041234567",
              phone_number_id: "106540352242922",
            },
            contacts: [
              { profile: { name: "Asha Menon" }, wa_id: "919876543210" },
            ],
            messages: [
              {
                from: "919876543210",
                id: "wamid.HBgMOTE5ODc2NTQzMjEwFQIAEhgg",
                timestamp: "1786000000",
                type: "text",
                text: { body: "Is the 3BHK still available?" },
                referral: {
                  source_url: "https://fb.me/2abc",
                  source_id: "120210000000000000",
                  source_type: "ad",
                  headline: "Skyline Residences — 3BHK from 1.2 Cr",
                  body: "Book a site visit this weekend",
                  media_type: "image",
                  image_url: "https://scontent.example/ad.jpg",
                  ctwa_clid: "ARBc9Xyz",
                },
              },
            ],
          },
        },
      ],
    },
  ],
};

function withMessage(message: Record<string, unknown>) {
  return {
    ...CTWA_BODY,
    entry: [
      {
        ...CTWA_BODY.entry[0],
        changes: [
          {
            ...CTWA_BODY.entry[0].changes[0],
            value: {
              ...CTWA_BODY.entry[0].changes[0].value,
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

describe("verifyMetaSignature", () => {
  const secret = "app-secret-value";
  const raw = '{"hello":"world"}';
  const good = `sha256=${createHmac("sha256", secret).update(raw, "utf8").digest("hex")}`;

  it("accepts a correct signature", () => {
    expect(verifyMetaSignature(raw, good, secret)).toBe(true);
  });

  it("rejects a body that differs by one byte", () => {
    expect(verifyMetaSignature('{"hello":"worlD"}', good, secret)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    expect(verifyMetaSignature(raw, good, "other-secret")).toBe(false);
  });

  it("rejects a missing or unprefixed header", () => {
    expect(verifyMetaSignature(raw, null, secret)).toBe(false);
    expect(verifyMetaSignature(raw, good.replace("sha256=", ""), secret)).toBe(false);
  });

  it("rejects malformed hex without throwing", () => {
    // timingSafeEqual throws on length mismatch, so the length check has to
    // come first — a garbage header must be a `false`, not a 500.
    expect(() => verifyMetaSignature(raw, "sha256=zzzz", secret)).not.toThrow();
    expect(verifyMetaSignature(raw, "sha256=zzzz", secret)).toBe(false);
  });
});

describe("parseWhatsAppWebhook", () => {
  it("pulls the message, the sender and the receiving number", () => {
    const event = parseWhatsAppWebhook(CTWA_BODY);
    expect(event.phoneNumberId).toBe("106540352242922");
    expect(event.displayPhoneNumber).toBe("918041234567");
    expect(event.messages).toHaveLength(1);
    expect(event.messages[0]).toMatchObject({
      wamid: "wamid.HBgMOTE5ODc2NTQzMjEwFQIAEhgg",
      from: "919876543210",
      type: "text",
      text: "Is the 3BHK still available?",
      profileName: "Asha Menon",
    });
  });

  it("reads the ad referral", () => {
    const [message] = parseWhatsAppWebhook(CTWA_BODY).messages;
    expect(message.referral).toMatchObject({
      source_id: "120210000000000000",
      source_type: "ad",
      headline: "Skyline Residences — 3BHK from 1.2 Cr",
      ctwa_clid: "ARBc9Xyz",
    });
  });

  it("returns no referral for an organic message", () => {
    const body = withMessage({
      from: "919876543210",
      id: "wamid.1",
      type: "text",
      text: { body: "hi" },
    });
    expect(parseWhatsAppWebhook(body).messages[0].referral).toBeNull();
  });

  it("treats an empty referral object as no referral", () => {
    // Otherwise "did this come from an ad?" would be true for a payload
    // carrying nothing but braces.
    const body = withMessage({
      from: "919876543210",
      id: "wamid.1",
      type: "text",
      text: { body: "hi" },
      referral: {},
    });
    expect(parseWhatsAppWebhook(body).messages[0].referral).toBeNull();
  });

  it("matches profile names by wa_id, not by position", () => {
    const body = {
      ...CTWA_BODY,
      entry: [
        {
          ...CTWA_BODY.entry[0],
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "1", display_phone_number: "2" },
                contacts: [
                  { profile: { name: "First" }, wa_id: "911111111111" },
                  { profile: { name: "Second" }, wa_id: "922222222222" },
                ],
                messages: [
                  { from: "922222222222", id: "wamid.a", type: "text", text: { body: "x" } },
                  { from: "911111111111", id: "wamid.b", type: "text", text: { body: "y" } },
                ],
              },
            },
          ],
        },
      ],
    };
    const names = parseWhatsAppWebhook(body).messages.map((m) => m.profileName);
    expect(names).toEqual(["Second", "First"]);
  });

  it("returns no messages for a delivery-status callback", () => {
    const body = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "106540352242922" },
                statuses: [{ id: "wamid.x", status: "delivered" }],
              },
            },
          ],
        },
      ],
    };
    expect(parseWhatsAppWebhook(body).messages).toHaveLength(0);
  });

  it("survives garbage without throwing", () => {
    for (const input of [null, undefined, "text", 42, [], { entry: "no" }]) {
      expect(parseWhatsAppWebhook(input).messages).toHaveLength(0);
    }
  });

  it("skips messages with no id or no sender — neither can be deduped or matched", () => {
    const body = withMessage({ type: "text", text: { body: "orphan" } });
    expect(parseWhatsAppWebhook(body).messages).toHaveLength(0);
  });

  it("reads the body of non-text message types", () => {
    const cases: Array<[Record<string, unknown>, string | null]> = [
      [{ type: "image", image: { caption: "Floor plan?" } }, "Floor plan?"],
      [{ type: "button", button: { text: "Book a visit" } }, "Book a visit"],
      [
        {
          type: "interactive",
          interactive: { button_reply: { title: "Yes, call me" } },
        },
        "Yes, call me",
      ],
      [{ type: "location", location: { latitude: 1, longitude: 2 } }, null],
    ];
    for (const [extra, expected] of cases) {
      const body = withMessage({ from: "919876543210", id: "wamid.1", ...extra });
      expect(parseWhatsAppWebhook(body).messages[0].text).toBe(expected);
    }
  });
});

describe("normaliseWhatsAppLead", () => {
  it("keeps the phone as sent — it already matches phone_normalized", () => {
    const [message] = parseWhatsAppWebhook(CTWA_BODY).messages;
    const lead = normaliseWhatsAppLead(message);
    expect(lead.phone).toBe("919876543210");
    expect(lead.source).toBe("whatsapp");
    expect(lead.name).toBe("Asha Menon");
  });

  it("stores the ad context and the click id", () => {
    const [message] = parseWhatsAppWebhook(CTWA_BODY).messages;
    const lead = normaliseWhatsAppLead(message);
    expect(lead.snapshot.custom_data.whatsapp).toMatchObject({
      ad_id: "120210000000000000",
      ad_headline: "Skyline Residences — 3BHK from 1.2 Cr",
      ctwa_clid: "ARBc9Xyz",
      first_message: "Is the 3BHK still available?",
      message_type: "text",
    });
  });

  it("writes no ad keys for an organic message", () => {
    const body = withMessage({
      from: "919876543210",
      id: "wamid.1",
      type: "text",
      text: { body: "hi" },
    });
    const [message] = parseWhatsAppWebhook(body).messages;
    const stored = normaliseWhatsAppLead(message).snapshot.custom_data.whatsapp;
    expect(stored).toEqual({ first_message: "hi", message_type: "text" });
  });

  it("omits a null first_message rather than storing it", () => {
    // A null in the JSONB registers a catalog field that never has a value and
    // shows as a blank row on every sheet configured to display it.
    const body = withMessage({
      from: "919876543210",
      id: "wamid.1",
      type: "location",
      location: { latitude: 1, longitude: 2 },
    });
    const [message] = parseWhatsAppWebhook(body).messages;
    const stored = normaliseWhatsAppLead(message).snapshot.custom_data.whatsapp;
    expect(stored).toEqual({ message_type: "location" });
  });
});
