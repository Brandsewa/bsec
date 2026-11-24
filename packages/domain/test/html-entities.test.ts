import { describe, expect, it } from "vitest";
import { decodeEntities } from "../src/html-entities.ts";
import { buildCategorySeoMetadata, buildProductSeoMetadata, formatTitle } from "../src/storefront/seo.ts";
import { brandedTitle } from "../src/blog/seo.ts";

describe("decodeEntities", () => {
  it("decodes the entities an import leaves in a title, once or twice escaped", () => {
    expect(decodeEntities("Wholesale &amp; Bulk Tea")).toBe("Wholesale & Bulk Tea");
    expect(decodeEntities("Wholesale &amp;amp; Bulk")).toBe("Wholesale & Bulk");
    expect(decodeEntities("It&#39;s &quot;fresh&quot; &ndash; 100&#x25;")).toBe("It's \"fresh\" – 100%");
  });

  it("leaves plain text, a lone ampersand and unknown entities alone", () => {
    expect(decodeEntities("Tea & Honey")).toBe("Tea & Honey");
    expect(decodeEntities("AT&T")).toBe("AT&T");
    expect(decodeEntities("&notanentity;")).toBe("&notanentity;");
    expect(decodeEntities("&#0; &#xD800;")).toBe("&#0; &#xD800;");
  });
});

describe("titles in the page head are plain text", () => {
  it("formatTitle decodes the page name and the store name, and keeps $ patterns literal", () => {
    expect(formatTitle(null, "Weight Loss &amp; Detox", "Ricwell")).toBe("Weight Loss & Detox | Ricwell");
    expect(formatTitle("%s - {{store_name}}", "A &amp; B", "Shop &amp; Co")).toBe("A & B - Shop & Co");
    expect(formatTitle(null, "Costs $& more", "S")).toBe("Costs $& more | S");
  });

  it("product and category pages decode a saved SEO title and description", () => {
    const product = buildProductSeoMetadata({
      product: { title: "Matcha", slug: "matcha", status: "active", seo: { title: "Matcha &amp; Green Tea", description: "Fresh &amp; bright" } },
      seoSettings: null,
      storeSettings: { storeName: "Shop" },
      host: "shop.example",
    });
    expect(product.title).toBe("Matcha & Green Tea");
    expect(product.description).toBe("Fresh & bright");

    const category = buildCategorySeoMetadata({
      category: { name: "Weight Loss &amp; Detox", slug: "weight-loss", description: null, seo: {} },
      seoSettings: null,
      storeSettings: { storeName: "Shop" },
      productsCount: 3,
      host: "shop.example",
    } as never);
    expect(category.title).toBe("Weight Loss & Detox | Shop");
  });

  it("blog titles decode too", () => {
    expect(brandedTitle("Tea &amp; Honey", "Ricwell")).toBe("Tea & Honey | Ricwell");
    expect(brandedTitle("Ricwell &amp; You", "Ricwell")).toBe("Ricwell & You");
  });
});
