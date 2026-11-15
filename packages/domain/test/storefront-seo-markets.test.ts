import { describe, expect, it } from "vitest";
import { buildHreflangAlternates, homeLanguageAlternates, marketHreflangs } from "../src/storefront/seo-markets.ts";
import { generateSitemapXml } from "../src/storefront/seo.ts";
import type { StorefrontMarket } from "../src/markets/lookup.ts";

const m = (o: Partial<StorefrontMarket>): StorefrontMarket => ({ id: "m", name: "M", handle: "m", isBase: false, currency: "USD", locale: "en-US", pathPrefix: "/us", unitSystem: null, taxDisplay: "exclusive", catalogMode: "all", countries: [], ...o });
const base = m({ id: "b", isBase: true, currency: "INR", locale: "en-IN", pathPrefix: null });
const us = m({ id: "u" });

describe("marketHreflangs", () => {
  it("maps each market to its language-region code", () => {
    expect([...marketHreflangs([base, us])!]).toEqual([["b", "en-IN"], ["u", "en-US"]]);
  });
  it("falls back to the currency's default locale and normalises underscores", () => {
    expect(marketHreflangs([base, m({ id: "g", locale: "en_GB", pathPrefix: "/uk" })])!.get("g")).toBe("en-GB");
    expect(marketHreflangs([m({ id: "b", isBase: true, locale: null, currency: "INR", pathPrefix: null }), us])!.get("b")).toMatch(/^en-IN$/);
  });
  it("is null for one market, repeated codes or an invalid code", () => {
    expect(marketHreflangs([base])).toBeNull();
    expect(marketHreflangs([base, m({ id: "x", locale: "en-IN", pathPrefix: "/x" })])).toBeNull();
    expect(marketHreflangs([base, m({ id: "x", locale: "not a code", pathPrefix: "/x" })])).toBeNull();
  });
});

describe("buildHreflangAlternates", () => {
  const codes = marketHreflangs([base, us])!;
  it("lists every serving market plus x-default at the base URL", () => {
    const alts = buildHreflangAlternates([{ marketId: "b", isBase: true, href: "https://s.com/products/a" }, { marketId: "u", isBase: false, href: "https://s.com/us/products/a" }], codes);
    expect(alts).toEqual([
      { hreflang: "en-IN", href: "https://s.com/products/a" },
      { hreflang: "en-US", href: "https://s.com/us/products/a" },
      { hreflang: "x-default", href: "https://s.com/products/a" },
    ]);
  });
  it("gives a page served by one market no alternates", () => {
    expect(buildHreflangAlternates([{ marketId: "b", isBase: true, href: "https://s.com/products/a" }], codes)).toEqual([]);
  });
});

describe("homeLanguageAlternates", () => {
  it("maps codes to home URLs with x-default", () => {
    expect(homeLanguageAlternates([base, us], "s.com")).toEqual({ "en-IN": "https://s.com", "en-US": "https://s.com/us", "x-default": "https://s.com" });
  });
  it("is undefined when a market has no prefix to tell it apart", () => {
    expect(homeLanguageAlternates([base, m({ id: "x", pathPrefix: null })], "s.com")).toBeUndefined();
  });
});

describe("generateSitemapXml images and hreflang", () => {
  it("keeps the plain namespace when nothing uses the extensions", () => {
    expect(generateSitemapXml([{ loc: "https://s.com/" }])).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  });
  it("declares the namespaces and escapes image and alternate values", () => {
    const xml = generateSitemapXml([
      { loc: "https://s.com/products/a", images: [{ loc: "https://m.com/a.png?x=1&y=2", title: "Tea & <more>" }], alternates: [{ hreflang: "en-US", href: "https://s.com/us/products/a" }] },
    ]);
    expect(xml).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"');
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(xml).toContain("<image:loc>https://m.com/a.png?x=1&amp;y=2</image:loc>");
    expect(xml).toContain("<image:title>Tea &amp; &lt;more&gt;</image:title>");
    expect(xml).toContain('<xhtml:link rel="alternate" hreflang="en-US" href="https://s.com/us/products/a"/>');
  });
});
