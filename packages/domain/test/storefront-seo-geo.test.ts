import { describe, expect, it } from "vitest";
import {
  buildHomeSeoMetadata,
  buildProductSeoMetadata,
  generateLlmsTxt,
  generateProductJsonLd,
  generateSitemapXml,
  type SeoSettings,
  type StorefrontProductDetail,
} from "../src/index.ts";

const settings: SeoSettings = {
  indexingEnabled: true,
  titleTemplate: "%s | {{store_name}}",
  defaultMetaDescription: null,
  defaultOgImageMediaId: null,
  twitterHandle: null,
  organizationSchema: null,
  localBusiness: null,
  robotsExtra: null,
  aiCrawlers: null,
  breadcrumbsEnabled: true,
  faqSchemaEnabled: true,
};

function product(overrides: Partial<StorefrontProductDetail> = {}, variant: Partial<StorefrontProductDetail["variants"][number]> = {}): StorefrontProductDetail {
  return {
    id: "p1",
    title: "Matcha",
    slug: "matcha",
    status: "active",
    descriptionJson: null,
    shortDescription: "Ceremonial grade",
    brandId: null,
    brand: null,
    productType: "Green tea",
    tags: [],
    seo: null,
    requiresShipping: true,
    isFeatured: false,
    priceOnRequest: false,
    ratingAvg: "0",
    ratingCount: 0,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    options: [],
    media: [],
    variants: [
      {
        id: "v1",
        productId: "p1",
        sku: "MATCHA-1",
        barcode: null,
        title: "Default",
        optionValues: null,
        price: 63700,
        trackInventory: true,
        allowBackorder: false,
        position: 0,
        imageMediaId: null,
        stockStatus: "in_stock",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        ...variant,
      },
    ],
    ...overrides,
  } as StorefrontProductDetail;
}

describe("Product JSON-LD (Google product snippets)", () => {
  it("publishes the price a shopper sees, not the stored minor units", () => {
    // Regression: ricwell.com showed ₹637 on the page and "price": 63700 in the schema.
    const ld = generateProductJsonLd(product(), "https://shop.test");
    expect(ld.offers?.[0]?.price).toBe(637);
  });

  it("respects the currency's decimals (JPY has none, KWD has three)", () => {
    expect(generateProductJsonLd(product({}, { price: 5000 }), "https://shop.test", "JPY").offers?.[0]?.price).toBe(5000);
    expect(generateProductJsonLd(product({}, { price: 12345 }), "https://shop.test", "KWD").offers?.[0]?.price).toBe(12.345);
  });

  it("adds an id, url, sku and category so the entity is addressable", () => {
    const ld = generateProductJsonLd(product(), "https://shop.test/");
    expect(ld["@id"]).toBe("https://shop.test/products/matcha#product");
    expect(ld["url"]).toBe("https://shop.test/products/matcha");
    expect(ld["sku"]).toBe("MATCHA-1");
    expect(ld["category"]).toBe("Green tea");
  });

  it("uses the market's path prefix in product URLs", () => {
    const ld = generateProductJsonLd(product(), "https://shop.test", "USD", { urlPrefix: "us" });
    expect(ld["url"]).toBe("https://shop.test/us/products/matcha");
  });

  it("only publishes a barcode that is a valid GTIN length", () => {
    expect(generateProductJsonLd(product({}, { barcode: "8901234567890" }), "https://shop.test").offers?.[0]?.["gtin"]).toBe("8901234567890");
    expect(generateProductJsonLd(product({}, { barcode: "ABC-12" }), "https://shop.test").offers?.[0]?.["gtin"]).toBeUndefined();
    expect(generateProductJsonLd(product({}, { barcode: "12345" }), "https://shop.test").offers?.[0]?.["gtin"]).toBeUndefined();
  });

  it("maps backorder and preorder to the right availability", () => {
    expect(generateProductJsonLd(product({}, { stockStatus: "out_of_stock", allowBackorder: true }), "https://shop.test").offers?.[0]?.availability).toBe("https://schema.org/BackOrder");
    expect(generateProductJsonLd(product({}, { preorderEnabled: true }), "https://shop.test").offers?.[0]?.availability).toBe("https://schema.org/PreOrder");
    expect(generateProductJsonLd(product({}, { stockStatus: "out_of_stock" }), "https://shop.test").offers?.[0]?.availability).toBe("https://schema.org/OutOfStock");
  });

  it("names the seller when the store name is known", () => {
    const ld = generateProductJsonLd(product(), "https://shop.test", "INR", { storeName: "Ricwell" });
    expect(ld.offers?.[0]?.["seller"]).toEqual({ "@type": "Organization", name: "Ricwell" });
  });

  it("publishes no offer for a price-on-request product (there is no price to state)", () => {
    expect(generateProductJsonLd(product({ priceOnRequest: true }), "https://shop.test").offers).toBeUndefined();
  });
});

describe("Home page metadata", () => {
  const base = { seoSettings: settings, storeSettings: { storeName: "Ricwell" }, host: "ricwell.com" };

  it("uses the store name instead of the generic 'Home' page title and a real description", () => {
    const m = buildHomeSeoMetadata({ ...base, homePage: { title: "Home", seo: null } });
    expect(m.title).toBe("Ricwell");
    expect(m.description).not.toMatch(/welcome to our store/i);
    expect(m.description).toContain("Ricwell");
    expect(m.alternates.canonical).toBe("https://ricwell.com/");
    expect(m.openGraph.url).toBe("https://ricwell.com/");
    expect(m.robots).toEqual({ index: true, follow: true });
  });

  it("prefers the merchant's SEO title and description, then the store-wide default", () => {
    const own = buildHomeSeoMetadata({ ...base, homePage: { title: "Home", seo: { title: "Darjeeling tea, direct from the gardens", description: "Private label tea." } } });
    expect(own.title).toBe("Darjeeling tea, direct from the gardens");
    expect(own.description).toBe("Private label tea.");
    const dflt = buildHomeSeoMetadata({ ...base, seoSettings: { ...settings, defaultMetaDescription: "Store default." }, homePage: { title: "Home" } });
    expect(dflt.description).toBe("Store default.");
  });

  it("canonicalises a market home to its prefix and noindexes a blocked store", () => {
    expect(buildHomeSeoMetadata({ ...base, homePage: null, prefix: "us" }).alternates.canonical).toBe("https://ricwell.com/us");
    expect(buildHomeSeoMetadata({ ...base, homePage: null, storeStatusMode: "coming_soon" }).robots).toEqual({ index: false, follow: false });
  });
});

describe("Product page share metadata", () => {
  it("carries og:url and og:site_name", () => {
    const m = buildProductSeoMetadata({
      product: { title: "Matcha", slug: "matcha", status: "active", shortDescription: "x", media: [{ url: "https://cdn.test/a.webp" }] },
      seoSettings: settings,
      storeSettings: { storeName: "Ricwell" },
      host: "ricwell.com",
    });
    expect(m.openGraph.url).toBe("https://ricwell.com/products/matcha");
    expect(m.openGraph.siteName).toBe("Ricwell");
  });
});

describe("Sitemap XML", () => {
  it("escapes characters that would make the file invalid", () => {
    const xml = generateSitemapXml([{ loc: "https://shop.test/products/a?x=1&y=2" }]);
    expect(xml).toContain("<loc>https://shop.test/products/a?x=1&amp;y=2</loc>");
    expect(xml).not.toContain("&y=2");
  });
});

describe("llms.txt", () => {
  const input = {
    storeName: "Ricwell",
    baseUrl: "https://ricwell.com/",
    summary: "Darjeeling tea partner.",
    categories: [{ name: "Green tea", slug: "green-tea", description: "Loose leaf green teas." }],
    collections: [],
    products: [{ title: "Matcha", slug: "matcha", shortDescription: "Ceremonial\n grade" }],
    pages: [{ title: "About", path: "/pages/about" }],
    blog: true,
    policies: [{ title: "Privacy policy", handle: "privacy" }],
  };

  it("follows the llmstxt.org shape: H1, blockquote summary, link sections", () => {
    const txt = generateLlmsTxt(input);
    expect(txt.startsWith("# Ricwell\n\n> Darjeeling tea partner.\n")).toBe(true);
    expect(txt).toContain("## Shop by category");
    expect(txt).toContain("- [Green tea](https://ricwell.com/categories/green-tea): Loose leaf green teas.");
    expect(txt).toContain("- [Matcha](https://ricwell.com/products/matcha): Ceremonial grade");
    expect(txt).toContain("- [Sitemap](https://ricwell.com/sitemap.xml)");
    expect(txt).toContain("https://ricwell.com/blog/feed.xml");
  });

  it("omits empty sections and caps the product list", () => {
    const txt = generateLlmsTxt({ ...input, blog: false, categories: [], products: Array.from({ length: 5 }, (_, i) => ({ title: `P${i}`, slug: `p${i}` })), productLimit: 2 });
    expect(txt).not.toContain("## Shop by category");
    expect(txt).not.toContain("## Collections");
    expect(txt).not.toContain("## Blog");
    expect(txt).toContain("/products/p1");
    expect(txt).not.toContain("/products/p2");
  });
});
