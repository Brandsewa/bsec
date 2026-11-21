import { describe, expect, it } from "vitest";
import { buildSeoHealthChecks } from "../src/admin/seo-health.ts";

const good = {
  storeLive: true,
  indexingEnabled: true,
  blockedAgents: [] as string[],
  listedProducts: 10,
  productsWithoutDescription: 0,
  productsWithoutImage: 0,
  imagesWithoutAlt: 0,
  categoriesWithoutDescription: 0,
  collectionsWithoutDescription: 0,
  publishedPolicies: 4,
  hasShareImage: true,
  hasFavicon: true,
  hasContact: true,
  hasShippingRates: true,
};
const byId = (checks: ReturnType<typeof buildSeoHealthChecks>) => Object.fromEntries(checks.map((c) => [c.id, c]));

describe("buildSeoHealthChecks", () => {
  it("reports every check as ok for a complete store", () => {
    const checks = buildSeoHealthChecks(good);
    expect(checks.every((c) => c.status === "ok")).toBe(true);
  });

  it("fails visibility when the store is not live or asks to be left out, with different wording", () => {
    const hidden = byId(buildSeoHealthChecks({ ...good, indexingEnabled: false }));
    expect(hidden["visibility"]).toMatchObject({ status: "fail", fixHref: "/settings/storefront" });
    expect(hidden["visibility"]!.detail).toMatch(/discourage/i);
    const notLive = byId(buildSeoHealthChecks({ ...good, storeLive: false }));
    expect(notLive["visibility"]!.detail).toMatch(/not live/i);
  });

  it("names the blocked AI agents", () => {
    const c = byId(buildSeoHealthChecks({ ...good, blockedAgents: ["PerplexityBot", "ChatGPT-User"] }));
    expect(c["ai-agents"]).toMatchObject({ status: "warn", count: 2 });
    expect(c["ai-agents"]!.detail).toContain("PerplexityBot, ChatGPT-User");
  });

  it("counts missing content with a fix link and singular and plural wording", () => {
    const c = byId(buildSeoHealthChecks({ ...good, productsWithoutDescription: 1, imagesWithoutAlt: 12, categoriesWithoutDescription: 2 }));
    expect(c["product-description"]).toMatchObject({ status: "warn", count: 1, fixHref: "/products" });
    expect(c["product-description"]!.detail).toContain("1 product with no description");
    expect(c["image-alt"]!.detail).toContain("12 pictures");
    expect(c["category-description"]!.detail).toContain("2 categories");
    expect(c["product-image"]).toMatchObject({ status: "ok" });
  });

  it("flags unpublished policies, missing share image, favicon, contact and shipping", () => {
    const c = byId(buildSeoHealthChecks({ ...good, publishedPolicies: 1, hasShareImage: false, hasFavicon: false, hasContact: false, hasShippingRates: false }));
    expect(c["policies"]).toMatchObject({ status: "warn", count: 3, fixHref: "/settings/policies" });
    for (const id of ["share-image", "favicon", "contact", "shipping"]) expect(c[id]).toMatchObject({ status: "warn" });
  });

  it("does not claim a catalogue is incomplete when there are no products", () => {
    const c = byId(buildSeoHealthChecks({ ...good, listedProducts: 0 }));
    expect(c["product-description"]!.detail).toBe("No products yet.");
  });
});
