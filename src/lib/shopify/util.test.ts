import { describe, expect, it } from "vitest";

import { isValidShopDomain, normalizeShopDomain } from "@/lib/shopify/util";

describe("isValidShopDomain", () => {
  it("accepts canonical myshopify domains", () => {
    expect(isValidShopDomain("teststore.myshopify.com")).toBe(true);
    expect(isValidShopDomain("my-store-123.myshopify.com")).toBe(true);
  });

  it("rejects custom storefront domains and junk", () => {
    expect(isValidShopDomain("store.maishalifestyle.com")).toBe(false);
    expect(isValidShopDomain("teststore.myshopify.com.evil.com")).toBe(false);
    expect(isValidShopDomain("myshopify.com")).toBe(false);
    expect(isValidShopDomain("")).toBe(false);
    expect(isValidShopDomain(null)).toBe(false);
    expect(isValidShopDomain(undefined)).toBe(false);
  });
});

describe("normalizeShopDomain", () => {
  it("trims and lowercases a valid domain", () => {
    expect(normalizeShopDomain("  TestStore.MyShopify.com ")).toBe(
      "teststore.myshopify.com",
    );
  });

  it("returns null for invalid input", () => {
    expect(normalizeShopDomain("store.brand.com")).toBeNull();
    expect(normalizeShopDomain(null)).toBeNull();
  });
});
