import { describe, expect, it } from "vitest";

import {
  FALLBACK_NO_NUMBER,
  pickFromNumber,
  type DueContact,
  type IntegrationRow,
} from "@/lib/campaigns/dispatch";

// pickFromNumber only reads the caller-ID fields off these shapes, so we build
// minimal stand-ins and cast. Keeps the rotation/cap logic test focused.
function contact(campaign: {
  from_phone_number?: string | null;
  from_phone_numbers?: string[] | null;
} | null): DueContact {
  return {
    campaign:
      campaign === null
        ? null
        : {
            from_phone_number: campaign.from_phone_number ?? null,
            from_phone_numbers: campaign.from_phone_numbers ?? null,
          },
  } as unknown as DueContact;
}

function integration(o: Partial<IntegrationRow> = {}): IntegrationRow {
  return {
    organisation_id: "org-1",
    agent_id: "agent-1",
    api_key: "key",
    enabled: true,
    from_phone_number: null,
    daily_calls_per_number: 200,
    ...o,
  } as IntegrationRow;
}

describe("pickFromNumber — rotation pool", () => {
  it("picks the least-used number under the cap", () => {
    const c = contact({ from_phone_numbers: ["+A", "+B"] });
    const usage = new Map([
      ["+A", 5],
      ["+B", 2],
    ]);
    expect(pickFromNumber(c, integration(), usage)).toBe("+B");
  });

  it("breaks ties by pool order (stable)", () => {
    const c = contact({ from_phone_numbers: ["+A", "+B"] });
    expect(pickFromNumber(c, integration(), new Map())).toBe("+A");
  });

  it("skips numbers at the cap and uses the one with budget left", () => {
    const c = contact({ from_phone_numbers: ["+A", "+B"] });
    const usage = new Map([
      ["+A", 200],
      ["+B", 10],
    ]);
    expect(pickFromNumber(c, integration({ daily_calls_per_number: 200 }), usage)).toBe(
      "+B",
    );
  });

  it("returns null (defer) when every pool number is capped", () => {
    const c = contact({ from_phone_numbers: ["+A", "+B"] });
    const usage = new Map([
      ["+A", 200],
      ["+B", 200],
    ]);
    expect(pickFromNumber(c, integration(), usage)).toBeNull();
  });

  it("honours the per-org daily cap value", () => {
    const c = contact({ from_phone_numbers: ["+A"] });
    const intg = integration({ daily_calls_per_number: 3 });
    expect(pickFromNumber(c, intg, new Map([["+A", 2]]))).toBe("+A"); // 2 < 3
    expect(pickFromNumber(c, intg, new Map([["+A", 3]]))).toBeNull(); // 3 >= 3
  });

  it("falls back to the default cap (200) when the column is null", () => {
    const c = contact({ from_phone_numbers: ["+A"] });
    const intg = integration({ daily_calls_per_number: null });
    expect(pickFromNumber(c, intg, new Map([["+A", 199]]))).toBe("+A");
    expect(pickFromNumber(c, intg, new Map([["+A", 200]]))).toBeNull();
  });
});

describe("pickFromNumber — single-number precedence", () => {
  it("uses the campaign single override when no pool is set", () => {
    const c = contact({ from_phone_number: "+SINGLE" });
    expect(pickFromNumber(c, integration(), new Map())).toBe("+SINGLE");
  });

  it("returns null when the single override is at its cap", () => {
    const c = contact({ from_phone_number: "+SINGLE" });
    const usage = new Map([["+SINGLE", 200]]);
    expect(pickFromNumber(c, integration(), usage)).toBeNull();
  });

  it("falls back to the org default when neither pool nor campaign number is set", () => {
    const c = contact({});
    const intg = integration({ from_phone_number: "+ORGDEFAULT" });
    expect(pickFromNumber(c, intg, new Map())).toBe("+ORGDEFAULT");
  });

  it("campaign single override wins over the org default", () => {
    const c = contact({ from_phone_number: "+SINGLE" });
    const intg = integration({ from_phone_number: "+ORGDEFAULT" });
    expect(pickFromNumber(c, intg, new Map())).toBe("+SINGLE");
  });
});

describe("pickFromNumber — nothing configured", () => {
  it("returns the empty-string sentinel so Bolna dials from its own pool", () => {
    const c = contact({});
    expect(pickFromNumber(c, integration(), new Map())).toBe(FALLBACK_NO_NUMBER);
  });

  it("returns the sentinel even when contact has no campaign at all", () => {
    expect(pickFromNumber(contact(null), integration(), new Map())).toBe(
      FALLBACK_NO_NUMBER,
    );
  });
});
