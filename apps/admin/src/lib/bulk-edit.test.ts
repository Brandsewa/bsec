import { describe, expect, it } from "vitest";
import type { ProductDetail } from "@bs/contracts";
import { buildProductItems } from "./bulk-edit-products.ts";
import { editKey, parseDecimal, parseMoney, parseTags, parseWhole, slugify } from "./bulk-edit.ts";

const product = {
  id: "p1",
  title: "Tea",
  slug: "tea",
  status: "active",
  tags: [],
  seo: { title: "Old", description: "Desc" },
  primaryCategoryId: "c1",
  extraCategoryIds: ["c2", "c3"],
  collectionIds: [],
  variants: [{ id: "v1", sku: "T-1", dimensions: { lengthCm: 10, widthCm: 5 } }],
} as unknown as ProductDetail;

const e = (entries: Record<string, string | boolean | string[]>) => Object.fromEntries(Object.entries(entries).map(([k, v]) => [k.replace(":", "|"), v]));

describe("parsers", () => {
  it("parses money to minor units and rejects bad text", () => {
    expect(parseMoney("1,299.50", "INR")).toEqual({ ok: true, value: 129950 });
    expect(parseMoney("", "INR")).toEqual({ ok: true, value: null });
    expect(parseMoney("12.345", "INR").ok).toBe(false);
    expect(parseMoney("abc", "INR").ok).toBe(false);
  });
  it("parses whole numbers, decimals and tags", () => {
    expect(parseWhole("12", 100)).toEqual({ ok: true, value: 12 });
    expect(parseWhole("1.5", 100).ok).toBe(false);
    expect(parseWhole("101", 100).ok).toBe(false);
    expect(parseDecimal("2.5", 10)).toEqual({ ok: true, value: 2.5 });
    expect(parseTags("a, b,, a")).toEqual(["a", "b"]);
    expect(slugify(" Green Tea! ")).toBe("green-tea");
  });
});

describe("buildProductItems", () => {
  it("builds nothing when nothing changed", () => {
    expect(buildProductItems([product], {}, "INR")).toEqual({ items: [], errors: {} });
  });

  it("builds product and variant patches", () => {
    const { items, errors } = buildProductItems([product], e({ "p1:title": " Green Tea ", "v1:price": "125.5", "v1:stock": "7" }), "INR");
    expect(errors).toEqual({});
    expect(items).toEqual([{ id: "p1", product: { title: "Green Tea" }, variants: [{ id: "v1", price: 12550, stockOnHand: 7 }] }]);
  });

  it("sends both category fields and keeps the other extras when the primary changes", () => {
    const { items } = buildProductItems([product], e({ "p1:primaryCategoryId": "c2" }), "INR");
    expect(items[0]?.product).toMatchObject({ primaryCategoryId: "c2", extraCategoryIds: ["c3"] });
  });

  it("merges SEO edits with the saved value", () => {
    const { items } = buildProductItems([product], e({ "p1:seoTitle": "New" }), "INR");
    expect(items[0]?.product?.seo).toEqual({ title: "New", description: "Desc" });
  });

  it("merges dimensions with the saved ones and clears when all empty", () => {
    const a = buildProductItems([product], e({ "v1:heightCm": "3" }), "INR");
    expect(a.items[0]?.variants?.[0]?.dimensions).toEqual({ lengthCm: 10, widthCm: 5, heightCm: 3 });
    const b = buildProductItems([product], e({ "v1:lengthCm": "", "v1:widthCm": "" }), "INR");
    expect(b.items[0]?.variants?.[0]?.dimensions).toBeNull();
  });

  it("reports per-cell errors keyed like the edits", () => {
    const { errors } = buildProductItems([product], e({ "p1:title": " ", "v1:price": "abc", "v1:sku": "" }), "INR");
    expect(Object.keys(errors).sort()).toEqual([editKey("p1", "title"), editKey("v1", "price"), editKey("v1", "sku")].sort());
  });

  it("converts number custom fields and clears empty ones", () => {
    const { items, errors } = buildProductItems([product], e({ "p1:cf:d1": "42", "p1:cf:d2": "" }), "INR", { d1: "number" });
    expect(errors).toEqual({});
    expect(items[0]?.customFields).toEqual({ d1: 42, d2: null });
  });
});
