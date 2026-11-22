import { describe, it, expect } from "vitest";
import { legacyStorefrontPath } from "../src/lib/legacy-paths.ts";

describe("legacyStorefrontPath (storefront audit: old addresses that 404ed)", () => {
  it("sends /products to the all-products listing", () => {
    expect(legacyStorefrontPath("/products")).toBe("/products/all");
    expect(legacyStorefrontPath("/products/")).toBe("/products/all");
  });

  it("sends /collections/all and /categories/all to the lists of collections and categories", () => {
    expect(legacyStorefrontPath("/collections/all")).toBe("/collections");
    expect(legacyStorefrontPath("/categories/all/")).toBe("/categories");
  });

  it("maps Shopify blog addresses to /blog", () => {
    expect(legacyStorefrontPath("/blogs/tea-guides/how-to-brew")).toBe("/blog/how-to-brew");
    expect(legacyStorefrontPath("/blogs/news")).toBe("/blog");
    expect(legacyStorefrontPath("/blogs")).toBe("/blog");
  });

  it("leaves real pages alone, including a product page", () => {
    for (const p of ["/", "/products/green-tea", "/products/all", "/collections/teas", "/collections", "/blog/how-to-brew", "/blogs-and-more", "/blogs/a/b/c", "/pages/about"]) {
      expect(legacyStorefrontPath(p), p).toBeNull();
    }
  });
});
