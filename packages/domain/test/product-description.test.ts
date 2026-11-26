import { describe, expect, it } from "vitest";
import { normalizeProductDescription, plainTextOfDescription } from "../src/rich-description.ts";
import { buildProductSeoMetadata, cleanMetaText, generateProductJsonLd } from "../src/storefront/seo.ts";

const RICH = { v: 1, blocks: [{ type: "heading", level: 2, text: "Tasting notes" }, { type: "paragraph", text: "Bright, floral and lightly muscatel, grown above 1,800 metres." }, { type: "list", style: "unordered", items: ["2 g per 100 ml", "85 degrees"] }] };

describe("normalizeProductDescription", () => {
  it("keeps one plain paragraph as text and stores structured text as blocks", () => {
    expect(normalizeProductDescription({ type: "text", text: "  A plain description.  " })).toEqual({ type: "text", text: "A plain description." });
    const rich = normalizeProductDescription({ type: "text", text: "# Notes\nFloral.\n\n- 2 g\n- 85 C" }) as { v: number; blocks: Array<{ type: string }> };
    expect(rich.v).toBe(1);
    expect(rich.blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list"]);
  });

  it("validates blocks and treats empty content as no description", () => {
    expect(normalizeProductDescription(null)).toBeNull();
    expect(normalizeProductDescription(undefined)).toBeNull();
    expect(normalizeProductDescription({ type: "text", text: "   " })).toBeNull();
    expect(normalizeProductDescription({ v: 1, blocks: [] })).toBeNull();
    expect(normalizeProductDescription(RICH)).toMatchObject({ v: 1 });
    expect(() => normalizeProductDescription({ v: 1, blocks: [{ type: "paragraph", text: "Hi", marks: [{ type: "link", start: 0, end: 2, href: "javascript:alert(1)" }] }] })).toThrow(/Bad Request/);
    expect(() => normalizeProductDescription(42)).toThrow(/Bad Request/);
  });
});

describe("reading a description of either form", () => {
  it("returns the readable text of text and of blocks", () => {
    expect(plainTextOfDescription({ type: "text", text: "Plain." })).toBe("Plain.");
    expect(plainTextOfDescription(RICH)).toBe("Tasting notes\nBright, floral and lightly muscatel, grown above 1,800 metres.\n2 g per 100 ml\n85 degrees");
    expect(plainTextOfDescription(null)).toBe("");
  });

  it("the page description and the structured data use the first words of a formatted description", () => {
    expect(cleanMetaText(RICH)).toBe("Tasting notes Bright, floral and lightly muscatel, grown above 1,800 metres. 2 g per 100 ml 85 degrees");
    const meta = buildProductSeoMetadata({ product: { title: "Tea", slug: "tea", status: "active", shortDescription: "", descriptionJson: RICH }, seoSettings: null, storeSettings: { storeName: "Shop" }, host: "shop.example" });
    expect(meta.description?.startsWith("Tasting notes Bright, floral")).toBe(true);
    const ld = generateProductJsonLd({ title: "Tea", slug: "tea", variants: [], media: [], brand: null, shortDescription: null, descriptionJson: RICH } as never, "https://shop.example", "INR");
    expect(ld.description?.startsWith("Tasting notes")).toBe(true);
  });
});
