import { describe, expect, it } from "vitest";
import { DEFAULT_PAGES, resolveDefaultPages, validateDefaultPages } from "../src/default-pages.ts";

describe("default pages copy", () => {
  it("falls back to the built-in text for missing or garbage input", () => {
    expect(resolveDefaultPages(undefined)).toEqual(DEFAULT_PAGES);
    expect(resolveDefaultPages("nope")).toEqual(DEFAULT_PAGES);
    expect(resolveDefaultPages([])).toEqual(DEFAULT_PAGES);
  });

  it("merges a theme's partial copy over the defaults, section by section", () => {
    const r = resolveDefaultPages({ notFound: { heading: "Lost?" }, checkout: { showTrustBadges: false } });
    expect(r.notFound).toEqual({ heading: "Lost?", message: DEFAULT_PAGES.notFound.message });
    expect(r.checkout.showTrustBadges).toBe(false);
    expect(r.orderSuccess).toEqual(DEFAULT_PAGES.orderSuccess);
  });

  it("ignores an invalid section instead of breaking the page", () => {
    const r = resolveDefaultPages({ notFound: { heading: "<b>x</b>" }, search: { emptyMessage: "Nothing here" } });
    expect(r.notFound).toEqual(DEFAULT_PAGES.notFound);
    expect(r.search.emptyMessage).toBe("Nothing here");
  });

  it("rejects HTML, empty text, over-long text, wrong types and unknown sections when saving", () => {
    expect(() => validateDefaultPages({ notFound: { heading: "<script>" } })).toThrow(/Default pages/);
    expect(() => validateDefaultPages({ notFound: { heading: "   " } })).toThrow(/Default pages/);
    expect(() => validateDefaultPages({ notFound: { message: "x".repeat(201) } })).toThrow(/Default pages/);
    expect(() => validateDefaultPages({ checkout: { showTrustBadges: "yes" } })).toThrow(/Default pages/);
    expect(() => validateDefaultPages({ other: {} })).toThrow(/Default pages/);
    expect(validateDefaultPages({ notFound: { heading: "Fine" } }).notFound.heading).toBe("Fine");
    expect(validateDefaultPages(undefined)).toEqual(DEFAULT_PAGES);
  });
});
