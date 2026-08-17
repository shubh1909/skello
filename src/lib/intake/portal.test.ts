import { describe, expect, it } from "vitest";

import {
  decodePortalRequest,
  normalisePortalLead,
  observedFields,
  resolveTarget,
} from "./portal";

const decode = (
  rawBody: string,
  contentType: string | null = null,
  query = "",
) =>
  decodePortalRequest({
    contentType,
    rawBody,
    searchParams: new URLSearchParams(query),
  });

describe("decodePortalRequest", () => {
  it("reads a JSON body", () => {
    expect(decode('{"Mobile":"9876543210","Name":"Asha"}', "application/json")).toEqual({
      Mobile: "9876543210",
      Name: "Asha",
    });
  });

  it("reads a form-encoded body", () => {
    expect(
      decode(
        "Mobile=9876543210&Name=Asha+Menon",
        "application/x-www-form-urlencoded",
      ),
    ).toEqual({ Mobile: "9876543210", Name: "Asha Menon" });
  });

  it("reads query-string params, for portals that send a plain GET", () => {
    expect(decode("", null, "mobile=9876543210&name=Asha")).toEqual({
      mobile: "9876543210",
      name: "Asha",
    });
  });

  it("never treats our own auth params as lead data", () => {
    const fields = decode("", null, "api_key=secret&token=abc&mobile=99");
    expect(fields).toEqual({ mobile: "99" });
  });

  it("decodes JSON even when the Content-Type says otherwise", () => {
    // Portals mislabel bodies. Refusing an enquiry over a header would be
    // losing a lead to a formality.
    expect(decode('{"mobile":"99"}', "text/plain")).toEqual({ mobile: "99" });
  });

  it("falls back to form decoding when JSON is malformed", () => {
    expect(decode("mobile=99&name=Asha", "application/json")).toEqual({
      mobile: "99",
      name: "Asha",
    });
  });

  it("flattens a nested body to dotted paths", () => {
    const fields = decode(
      '{"lead":{"contact":{"mobile":"99"},"project":"Skyline"}}',
      "application/json",
    );
    expect(fields).toEqual({
      "lead.contact.mobile": "99",
      "lead.project": "Skyline",
    });
  });

  it("keeps numbers and booleans as strings rather than dropping them", () => {
    expect(decode('{"price":12000000,"verified":true}', "application/json")).toEqual({
      price: "12000000",
      verified: "true",
    });
  });

  it("drops empty values but keeps the rest", () => {
    expect(decode('{"mobile":"99","email":"  ","city":null}', "application/json")).toEqual({
      mobile: "99",
    });
  });

  it("lets the body win over a query param of the same name", () => {
    expect(decode('{"mobile":"body"}', "application/json", "mobile=query")).toEqual({
      mobile: "body",
    });
  });

  it("returns nothing for an empty request rather than throwing", () => {
    expect(decode("")).toEqual({});
    expect(decode("   ", "application/json")).toEqual({});
  });
});

describe("resolveTarget", () => {
  it("matches aliases regardless of case and separators", () => {
    for (const name of ["Mobile", "mobile_no", "MOBILE NO.", "Mobile__c", "contactNumber"]) {
      expect(resolveTarget(name, {}).target).toBe("phone");
    }
  });

  it("matches on the leaf of a nested path", () => {
    expect(resolveTarget("lead.contact.Mobile__c", {}).target).toBe("phone");
  });

  it("does NOT guess price or budget", () => {
    // On a property portal that is either the buyer's budget or the listing's
    // asking price. Guessing wrong writes a number a salesperson acts on.
    const r = resolveTarget("Price__c", {});
    expect(r.target).toBeNull();
    // Runs of punctuation collapse to a single underscore.
    expect(r.customKey).toBe("price_c");
  });

  it("resolves a field name that contains a literal dot", () => {
    // "MOBILE NO." split on "." leaves an empty last segment. That silently
    // defeated every alias for the fields most likely to carry a phone.
    expect(resolveTarget("MOBILE NO.", {}).target).toBe("phone");
    expect(resolveTarget("Ph.", {}).target).toBeNull();
  });

  it("lets the admin map override an alias", () => {
    expect(resolveTarget("Mobile", { Mobile: "ignore" })).toMatchObject({
      target: "ignore",
      source: "map",
    });
  });

  it("lets the admin map rename a field to a custom key", () => {
    expect(resolveTarget("Project_Name__c", { Project_Name__c: "project" })).toMatchObject(
      { target: null, customKey: "project", source: "map" },
    );
  });

  it("accepts a map keyed by either the full path or the leaf", () => {
    expect(resolveTarget("lead.mobile", { "lead.mobile": "phone" }).target).toBe("phone");
    expect(resolveTarget("lead.weird", { weird: "phone" }).target).toBe("phone");
  });

  it("falls back to a sanitised custom key", () => {
    expect(resolveTarget("Possession Timeline?", {}).customKey).toBe(
      "possession_timeline",
    );
  });
});

describe("normalisePortalLead", () => {
  // The closest thing to a documented 99acres shape (Anarock's).
  const ANAROCK = {
    First_Name: "Asha",
    Last_Name: "Menon",
    Email: "asha@example.com",
    Mobile: "9876543210",
    Country: "India",
    Project_Name: "Skyline Residences",
    Property_Code: "SKY-3B",
    City: "Pune",
    Price: "12000000",
    Remarks: "Wants a site visit this weekend",
  };

  it("maps the documented shape onto lead fields", () => {
    const lead = normalisePortalLead(ANAROCK);
    expect(lead.phone).toBe("9876543210");
    expect(lead.name).toBe("Asha Menon");
    expect(lead.city).toBe("Pune");
    expect(lead.source).toBe("portal_99acres");
    expect(lead.snapshot.lead_data.email).toBe("asha@example.com");
  });

  it("keeps everything it did not recognise, under custom_data.portal", () => {
    const lead = normalisePortalLead(ANAROCK);
    expect(lead.snapshot.custom_data.portal).toMatchObject({
      project_name: "Skyline Residences",
      property_code: "SKY-3B",
      price: "12000000",
      remarks: "Wants a site visit this weekend",
      country: "India",
    });
  });

  it("prefers an explicit full name over the stitched parts", () => {
    const lead = normalisePortalLead({ ...ANAROCK, Name: "A. Menon" });
    expect(lead.name).toBe("A. Menon");
  });

  it("flags an enquiry with no phone instead of rejecting it", () => {
    const lead = normalisePortalLead({ Name: "Asha", Email: "a@b.com" });
    expect(lead.phone).toBeNull();
    // Filterable on the leads table and bindable on the sheet, because the
    // catalog registers it like any other field.
    expect(lead.snapshot.custom_data.portal).toMatchObject({ missing_phone: true });
  });

  it("does not flag an enquiry that has a phone", () => {
    const lead = normalisePortalLead(ANAROCK);
    expect(lead.snapshot.custom_data.portal).not.toHaveProperty("missing_phone");
  });

  it("honours an admin field map over the aliases", () => {
    const lead = normalisePortalLead(ANAROCK, {
      Project_Name: "project",
      Price: "budget",
      Country: "ignore",
    });
    const portal = lead.snapshot.custom_data.portal as Record<string, unknown>;
    expect(portal.project).toBe("Skyline Residences");
    expect(portal.budget).toBe("12000000");
    expect(portal).not.toHaveProperty("country");
    expect(portal).not.toHaveProperty("project_name");
  });

  it("works on a nested payload", () => {
    const fields = decode(
      '{"lead":{"Mobile":"99","Project_Name":"Skyline"}}',
      "application/json",
    );
    const lead = normalisePortalLead(fields);
    expect(lead.phone).toBe("99");
    expect(lead.snapshot.custom_data.portal).toMatchObject({
      lead_project_name: "Skyline",
    });
  });

  it("produces an empty snapshot rather than an empty bucket", () => {
    const lead = normalisePortalLead({ Mobile: "99" });
    // `missing_phone` is absent and nothing else was sent, so writing an empty
    // `portal` object would register a field that never has a value.
    expect(lead.snapshot.custom_data).toEqual({});
  });

  it("can be pointed at another portal's lead_source", () => {
    const lead = normalisePortalLead({ Mobile: "99" }, {}, "web_form");
    expect(lead.source).toBe("web_form");
  });
});

describe("observedFields", () => {
  it("collects keys across payloads, newest sample first", () => {
    const observed = observedFields([
      { body: { Mobile: "111", Project_Name: "Skyline" } },
      { body: { Mobile: "222", City: "Pune" } },
    ]);
    expect(observed.find((f) => f.path === "Mobile")).toEqual({
      path: "Mobile",
      sample: "111",
      seen: 2,
    });
    expect(observed.map((f) => f.path).sort()).toEqual([
      "City",
      "Mobile",
      "Project_Name",
    ]);
  });

  it("ranks the most frequently seen field first", () => {
    const observed = observedFields([
      { body: { Mobile: "1" } },
      { body: { Mobile: "2" } },
      { body: { Rare: "x" } },
    ]);
    expect(observed[0].path).toBe("Mobile");
  });

  it("decodes a stored raw string body", () => {
    const observed = observedFields([
      { contentType: "application/x-www-form-urlencoded", body: "Mobile=99&City=Pune" },
    ]);
    expect(observed.map((f) => f.path).sort()).toEqual(["City", "Mobile"]);
  });

  it("truncates a long sample so one pasted essay cannot break the table", () => {
    const observed = observedFields([{ body: { Remarks: "x".repeat(500) } }]);
    expect(observed[0].sample).toHaveLength(120);
  });
});
