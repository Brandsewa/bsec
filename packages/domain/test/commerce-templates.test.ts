import { describe, expect, it } from "vitest";
import { MODERN_TEMPLATE_PAGES, validateTemplatePages } from "../src/index.ts";

describe("Modern Commerce theme", () => {
  it("passes block validation for every page, including the cart", () => {
    const pages = validateTemplatePages(MODERN_TEMPLATE_PAGES);
    expect(Object.keys(pages).sort()).toEqual(["blog", "blog-post", "cart", "collection", "collections", "footer", "header", "home", "product"]);
    expect(pages["collections"]?.some((b) => b.type === "CollectionGrid" && b.props["showAll"] === true)).toBe(true);
    expect(pages["product"]?.map((b) => b.type)).toEqual(expect.arrayContaining(["ProductDetail"]));
    expect(pages["cart"]?.some((b) => b.type === "CartContents")).toBe(true);
    expect(pages["blog"]?.some((b) => b.type === "BlogListing")).toBe(true);
    expect(pages["blog-post"]?.some((b) => b.type === "BlogPostContent")).toBe(true);
    expect(pages["home"]?.some((b) => b.type === "BlogPosts")).toBe(true);
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
