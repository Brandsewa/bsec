import { describe, it, expect } from "vitest";
import { buildProductSeoMetadata, cleanMetaText, clampMetaDescription, deriveMetaDescription, generateProductJsonLd, META_DESCRIPTION_MAX } from "../src/storefront/seo.ts";

describe("deriveMetaDescription", () => {
  it("skips an empty string, which is not text (the bug that left product pages with no description)", () => {
    expect(deriveMetaDescription(["", "   ", null, undefined, "Second flush muscatel."], "fallback")).toBe("Second flush muscatel.");
  });

  it("uses the fallback when nothing has text, and never returns an empty string", () => {
    expect(deriveMetaDescription([], "fallback")).toBe("fallback");
    expect(deriveMetaDescription(["", "<p> </p>"], "fallback")).toBe("fallback");
  });

  it("strips tags and entities and collapses whitespace", () => {
    expect(cleanMetaText("<p>Rich &amp; <b>smooth</b></p>\n\n  tea&nbsp;leaf")).toBe("Rich & smooth tea leaf");
  });

  it("reads the admin's { type: 'text', text } description", () => {
    expect(deriveMetaDescription(["", { type: "text", text: "Long form copy here." }], "x")).toBe("Long form copy here.");
  });

  it("cuts long text at a word boundary with an ellipsis", () => {
    const long = "word ".repeat(80).trim();
    const out = deriveMetaDescription([long], "x");
    expect(out.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/wor…$/);
    expect(clampMetaDescription("short")).toBe("short");
  });
});

describe("buildProductSeoMetadata description", () => {
  const base = { slug: "tea", title: "Tea", status: "active" };
  const meta = (product: Record<string, unknown>) =>
    buildProductSeoMetadata({ product: { ...base, ...product }, seoSettings: null, storeSettings: { storeName: "Shop" }, host: "shop.example" }).description;

  it("falls back past an empty short description to the long one, then to a generated line", () => {
    expect(meta({ shortDescription: "", descriptionJson: { type: "text", text: "Whole leaf, hand rolled." } })).toBe("Whole leaf, hand rolled.");
    expect(meta({ shortDescription: "" })).toBe("Buy Tea at Shop.");
  });

  it("keeps a description the merchant wrote exactly as written", () => {
    expect(meta({ seo: { description: "My own words, kept as is." }, shortDescription: "ignored" })).toBe("My own words, kept as is.");
  });
});

describe("generateProductJsonLd brand", () => {
  const product = { title: "Tea", slug: "tea", variants: [], media: [], brand: null } as never;

  it("uses the store name when the product has no brand", () => {
    expect(generateProductJsonLd(product, "https://shop.example", "INR", { storeName: "Shop" }).brand).toEqual({ "@type": "Brand", name: "Shop" });
  });

  it("prefers the product's own brand", () => {
    const withBrand = { title: "Tea", slug: "tea", variants: [], media: [], brand: { id: "b", name: "Estate", slug: "estate", logoMediaId: null } } as never;
    expect(generateProductJsonLd(withBrand, "https://shop.example", "INR", { storeName: "Shop" }).brand).toEqual({ "@type": "Brand", name: "Estate" });
  });

  it("leaves brand out only when there is neither", () => {
    expect(generateProductJsonLd(product, "https://shop.example", "INR").brand).toBeUndefined();
  });
});

describe("firstTextOfBlocks", () => {
  const blocks = [
    { type: "Hero", props: { title: "Welcome", subtitle: "Short", primaryLabel: "Shop now" } },
    { type: "RichText", props: { body: "<p>We grow and pack single-estate Darjeeling teas in the hills, and ship them across India.</p>" } },
  ];

  it("returns the first real sentence of copy, skipping short labels", async () => {
    const { firstTextOfBlocks } = await import("../src/storefront/seo.ts");
    expect(firstTextOfBlocks(blocks)).toBe("We grow and pack single-estate Darjeeling teas in the hills, and ship them across India.");
  });

  it("returns an empty string when there is no copy", async () => {
    const { firstTextOfBlocks } = await import("../src/storefront/seo.ts");
    expect(firstTextOfBlocks([{ type: "Banner", props: { text: "Sale" } }])).toBe("");
    expect(firstTextOfBlocks(undefined)).toBe("");
  });
});
