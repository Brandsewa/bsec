import { describe, expect, it } from "vitest";
import { canonicalHostFor, type DomainRow } from "../src/domains/canonical.ts";

const d = (hostname: string, over: Partial<DomainRow> = {}): DomainRow => ({ hostname, type: "custom", status: "active", isPrimary: false, ...over });

describe("canonicalHostFor", () => {
  const www = d("www.shop.com", { isPrimary: true });
  const apex = d("shop.com");

  it("sends the bare domain to the primary www domain, and the other way round", () => {
    expect(canonicalHostFor("shop.com", [www, apex])).toBe("www.shop.com");
    expect(canonicalHostFor("SHOP.com:443", [www, apex])).toBe("www.shop.com");
    expect(canonicalHostFor("www.shop.com", [d("www.shop.com"), d("shop.com", { isPrimary: true })])).toBe("shop.com");
  });

  it("does nothing for the primary itself or a store with one domain", () => {
    expect(canonicalHostFor("www.shop.com", [www, apex])).toBeNull();
    expect(canonicalHostFor("shop.com", [d("shop.com", { isPrimary: true })])).toBeNull();
  });

  it("never redirects the store's platform address, or to one", () => {
    const platform = d("shop.bcom.si", { type: "platform_subdomain", isPrimary: false });
    expect(canonicalHostFor("shop.bcom.si", [www, platform])).toBeNull();
    expect(canonicalHostFor("shop.com", [d("shop.com"), d("shop.bcom.si", { type: "platform_subdomain", isPrimary: true })])).toBeNull();
  });

  it("only moves visitors between live domains", () => {
    expect(canonicalHostFor("shop.com", [d("www.shop.com", { isPrimary: true, status: "awaiting_dns" }), apex])).toBeNull();
    expect(canonicalHostFor("shop.com", [www, d("shop.com", { status: "failed" })])).toBeNull();
    expect(canonicalHostFor("other.com", [www, apex])).toBeNull();
  });
});
