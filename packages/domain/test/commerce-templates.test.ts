import { describe, expect, it } from "vitest";
import { MODERN_TEMPLATE_PAGES, validateTemplatePages } from "../src/index.ts";

describe("Modern Commerce theme", () => {
  it("passes block validation for every page, including the cart", () => {
    const pages = validateTemplatePages(MODERN_TEMPLATE_PAGES);
    expect(Object.keys(pages).sort()).toEqual(["cart", "collection", "footer", "header", "home", "product"]);
    expect(pages["cart"]?.some((b) => b.type === "CartContents")).toBe(true);
  });
});

describe("template page validation errors", () => {
  it("are reported as Bad Request so the editor shows the real reason instead of an internal error", () => {
    const bad = { home: [{ id: "x", type: "NotABlock", version: 1, props: {} }] } as never;
    expect(() => validateTemplatePages(bad)).toThrow(/^Bad Request: Page "home" is invalid/);
    expect(() => validateTemplatePages({} as never)).toThrow(/^Bad Request: A theme must define a "home" page/);
  });
});

describe("hero slider and product showcase in a theme", () => {
  it("are accepted by template validation", () => {
    const pages = {
      home: [
        { id: "hs", type: "HeroSlider", version: 1, props: { slides: [{ title: "Hello" }] } },
        { id: "ps", type: "ProductShowcase", version: 1, props: { tabs: [{ label: "New", source: "newest" }, { label: "Sale", source: "collection", collectionSlug: "sale" }] } },
      ],
    } as never;
    const out = validateTemplatePages(pages);
    expect(out["home"]?.map((b) => b.type)).toEqual(["HeroSlider", "ProductShowcase"]);
  });
});
