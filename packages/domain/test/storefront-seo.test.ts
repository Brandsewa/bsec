import { describe, expect, it } from "vitest";
import type { Db } from "@bs/db";
import type {
  Runtime,
  TenantContext,
  StorefrontProductDetail,
  SeoSettings,
} from "../src/index.ts";
import {
  formatTitle,
  generateTitle,
  generateOrganizationJsonLd,
  generateWebSiteJsonLd,
  generateProductJsonLd,
  generateBreadcrumbJsonLd,
  generateFaqJsonLd,
  generateItemListJsonLd,
  generateArticleJsonLd,
  generateLocalBusinessJsonLd,
  generateRobotsTxt,
  getStorefrontSeoSettings,
} from "../src/index.ts";

describe("Storefront SEO & JSON-LD Structured Data", () => {
  const tenantId = "0199a000-0000-7000-8000-000000000001";

  const publicCtx: TenantContext = {
    tenantId,
    storeStatus: "live",
    actor: { type: "anonymous" },
    roles: [],
    permissions: [],
    requestId: "req-seo-1",
  };

  const createMockRuntime = (mockDb: Db): Runtime => ({
    service: "web",
    _db: { db: mockDb, pool: {} as never, close: async () => {} },
    close: async () => {},
  });

  describe("Title template formatter", () => {
    it("formats title using default template when template is null, undefined, or empty", () => {
      expect(formatTitle(undefined, "Men's Sneakers", "Acme Store")).toBe("Men's Sneakers | Acme Store");
      expect(formatTitle(null, "Men's Sneakers", "Acme Store")).toBe("Men's Sneakers | Acme Store");
      expect(formatTitle("", "Men's Sneakers", "Acme Store")).toBe("Men's Sneakers | Acme Store");
    });

    it("formats title using custom template with %s and {{store_name}}", () => {
      expect(formatTitle("Buy %s online at {{store_name}}", "Running Shoes", "Acme Store")).toBe(
        "Buy Running Shoes online at Acme Store",
      );
      expect(formatTitle("{{store_name}} - %s", "Wireless Headphones", "TechStore")).toBe(
        "TechStore - Wireless Headphones",
      );
    });

    it("supports generateTitle alias if provided", () => {
      expect(generateTitle("%s · {{store_name}}", "About Us", "Brand")).toBe("About Us · Brand");
    });
  });

  describe("JSON-LD structured data generators", () => {
    it("generates Organization JSON-LD", () => {
      const jsonLd = generateOrganizationJsonLd({
        name: "Acme Retail",
        url: "https://acme.com",
        logoUrl: "https://cdn.acme.com/logo.png",
        sameAs: ["https://instagram.com/acme", "https://twitter.com/acme"],
      });

      expect(jsonLd["@context"]).toBe("https://schema.org");
      expect(jsonLd["@type"]).toBe("Organization");
      expect(jsonLd.name).toBe("Acme Retail");
      expect(jsonLd.url).toBe("https://acme.com");
      expect(jsonLd.logo).toBe("https://cdn.acme.com/logo.png");
      expect(jsonLd.sameAs).toEqual(["https://instagram.com/acme", "https://twitter.com/acme"]);
    });

    it("generates WebSite JSON-LD with SearchAction", () => {
      const jsonLd = generateWebSiteJsonLd({
        name: "Acme Store",
        url: "https://acme.com",
      });

      expect(jsonLd["@context"]).toBe("https://schema.org");
      expect(jsonLd["@type"]).toBe("WebSite");
      expect(jsonLd.name).toBe("Acme Store");
      expect(jsonLd.url).toBe("https://acme.com");
      expect(jsonLd.potentialAction).toEqual({
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: "https://acme.com/search?q={search_term_string}",
        },
        "query-input": "required name=search_term_string",
      });
    });

    it("generates Product JSON-LD with offers, availability, and aggregateRating", () => {
      const product: StorefrontProductDetail = {
        id: "prod-1",
        title: "Mechanical Keyboard",
        slug: "mechanical-keyboard",
        shortDescription: "Tactile clicky mechanical keyboard",
        ratingAvg: "4.75",
        ratingCount: 28,
        brand: {
          id: "brand-1",
          name: "Keychron",
          slug: "keychron",
          logoMediaId: null,
        },
        variants: [
          {
            id: "var-1",
            productId: "prod-1",
            sku: "KEY-BLUE",
            barcode: "1234567890123",
            title: "Blue Switch",
            optionValues: { Switch: "Blue" },
            price: 7999, // INR
            compareAtPrice: 8999,
            trackInventory: true,
            allowBackorder: false,
            position: 0,
            imageMediaId: null,
            stockStatus: "in_stock" as const,
            availableQuantity: 10,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-02",
          },
          {
            id: "var-2",
            productId: "prod-1",
            sku: "KEY-RED",
            barcode: null,
            title: "Red Switch",
            optionValues: { Switch: "Red" },
            price: 8499,
            trackInventory: true,
            allowBackorder: false,
            position: 1,
            imageMediaId: null,
            stockStatus: "out_of_stock" as const,
            availableQuantity: 0,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-02",
          },
        ],
        options: [],
        status: "published",
        descriptionJson: null,
        brandId: "brand-1",
        productType: null,
        tags: [],
        seo: null,
        requiresShipping: true,
        isFeatured: false,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-02",
        media: [
          {
            id: "m-1",
            productId: "prod-1",
            mediaId: "media-img-1",
            position: 0,
            alt: "Top view",
            url: "https://cdn.example.com/keyboard.jpg",
          },
        ],
      };

      const jsonLd = generateProductJsonLd(product, "https://acme.com");

      expect(jsonLd["@context"]).toBe("https://schema.org");
      expect(jsonLd["@type"]).toBe("Product");
      expect(jsonLd.name).toBe("Mechanical Keyboard");
      expect(jsonLd.description).toBe("Tactile clicky mechanical keyboard");
      expect(jsonLd.image).toEqual(["https://cdn.example.com/keyboard.jpg"]);
      expect(jsonLd.brand).toEqual({
        "@type": "Brand",
        name: "Keychron",
      });
      expect(jsonLd.aggregateRating).toEqual({
        "@type": "AggregateRating",
        ratingValue: "4.75",
        reviewCount: 28,
      });

      expect(Array.isArray(jsonLd.offers)).toBe(true);
      expect(jsonLd.offers).toHaveLength(2);
      expect(jsonLd.offers![0]).toEqual({
        "@type": "Offer",
        price: 7999,
        priceCurrency: "INR",
        availability: "https://schema.org/InStock",
        url: "https://acme.com/products/mechanical-keyboard?variant=var-1",
        sku: "KEY-BLUE",
        itemCondition: "https://schema.org/NewCondition",
      });
      expect(jsonLd.offers![1]?.availability).toBe("https://schema.org/OutOfStock");
    });

    it("generates BreadcrumbList JSON-LD", () => {
      const items = [
        { name: "Home", url: "https://acme.com" },
        { name: "Electronics", url: "https://acme.com/categories/electronics" },
        { name: "Keyboards", url: "https://acme.com/collections/keyboards" },
      ];

      const jsonLd = generateBreadcrumbJsonLd(items);

      expect(jsonLd["@context"]).toBe("https://schema.org");
      expect(jsonLd["@type"]).toBe("BreadcrumbList");
      expect(jsonLd.itemListElement).toHaveLength(3);
      expect(jsonLd.itemListElement[0]).toEqual({
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: "https://acme.com",
      });
      expect(jsonLd.itemListElement[2]?.position).toBe(3);
    });

    it("generates FAQPage JSON-LD", () => {
      const faqs = [
        { question: "What is the return policy?", answer: "7 days free return." },
        { question: "Is cash on delivery available?", answer: "Yes, across all pincodes in India." },
      ];

      const jsonLd = generateFaqJsonLd(faqs);

      expect(jsonLd["@context"]).toBe("https://schema.org");
      expect(jsonLd["@type"]).toBe("FAQPage");
      expect(jsonLd.mainEntity).toHaveLength(2);
      expect(jsonLd.mainEntity[0]).toEqual({
        "@type": "Question",
        name: "What is the return policy?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "7 days free return.",
        },
      });
    });

    it("generates ItemList JSON-LD for collections or categories", () => {
      const items = [
        { name: "Product A", url: "https://acme.com/products/prod-a", position: 1 },
        { name: "Product B", url: "https://acme.com/products/prod-b", position: 2 },
      ];

      const jsonLd = generateItemListJsonLd("Summer Deals", items);

      expect(jsonLd["@context"]).toBe("https://schema.org");
      expect(jsonLd["@type"]).toBe("ItemList");
      expect(jsonLd.name).toBe("Summer Deals");
      expect(jsonLd.itemListElement).toHaveLength(2);
      expect(jsonLd.itemListElement[0]).toEqual({
        "@type": "ListItem",
        position: 1,
        url: "https://acme.com/products/prod-a",
        name: "Product A",
      });
    });

    it("generates Article JSON-LD for blog posts", () => {
      const jsonLd = generateArticleJsonLd({
        title: "Top 5 Mechanical Keyboards of 2026",
        description: "A comprehensive guide to switches and form factors.",
        author: "John Doe",
        publishedAt: "2026-03-15T10:00:00Z",
        url: "https://acme.com/blog/top-5-keyboards",
        imageUrl: "https://cdn.acme.com/blog-hero.jpg",
      });

      expect(jsonLd["@context"]).toBe("https://schema.org");
      expect(jsonLd["@type"]).toBe("Article");
      expect(jsonLd.headline).toBe("Top 5 Mechanical Keyboards of 2026");
      expect(jsonLd.description).toBe("A comprehensive guide to switches and form factors.");
      expect(jsonLd.author).toEqual({
        "@type": "Person",
        name: "John Doe",
      });
      expect(jsonLd.datePublished).toBe("2026-03-15T10:00:00Z");
      expect(jsonLd.mainEntityOfPage).toEqual({
        "@type": "WebPage",
        "@id": "https://acme.com/blog/top-5-keyboards",
      });
      expect(jsonLd.image).toEqual(["https://cdn.acme.com/blog-hero.jpg"]);
    });

    it("generates LocalBusiness JSON-LD", () => {
      const jsonLd = generateLocalBusinessJsonLd({
        name: "Acme Flagship Store",
        address: "123 MG Road, Bengaluru, Karnataka 560001",
        phone: "+91 98765 43210",
        geo: { lat: 12.9716, lng: 77.5946 },
      });

      expect(jsonLd["@context"]).toBe("https://schema.org");
      expect(jsonLd["@type"]).toBe("LocalBusiness");
      expect(jsonLd.name).toBe("Acme Flagship Store");
      expect(jsonLd.address).toBe("123 MG Road, Bengaluru, Karnataka 560001");
      expect(jsonLd.telephone).toBe("+91 98765 43210");
      expect(jsonLd.geo).toEqual({
        "@type": "GeoCoordinates",
        latitude: 12.9716,
        longitude: 77.5946,
      });
    });
  });

  describe("Robots.txt generator", () => {
    it("disallows all when indexing is disabled", () => {
      const settings: SeoSettings = {
        indexingEnabled: false,
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

      const robots = generateRobotsTxt(settings, "live", "example.com");

      expect(robots).toContain("User-agent: *");
      expect(robots).toContain("Disallow: /");
      expect(robots).not.toContain("Sitemap:");
    });

    it("disallows all when storeStatus mode is coming_soon or password", () => {
      const baseSettings: SeoSettings = {
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

      const robotsComingSoon = generateRobotsTxt(baseSettings, "coming_soon", "example.com");
      expect(robotsComingSoon).toContain("User-agent: *");
      expect(robotsComingSoon).toContain("Disallow: /");

      const robotsPassword = generateRobotsTxt(baseSettings, "password", "example.com");
      expect(robotsPassword).toContain("User-agent: *");
      expect(robotsPassword).toContain("Disallow: /");
    });

    it("generates default disallowed paths, AI crawler directives, robotsExtra, and sitemap when indexing enabled", () => {
      const settings: SeoSettings = {
        indexingEnabled: true,
        titleTemplate: "%s | {{store_name}}",
        defaultMetaDescription: null,
        defaultOgImageMediaId: null,
        twitterHandle: null,
        organizationSchema: null,
        localBusiness: null,
        robotsExtra: "Disallow: /private/",
        aiCrawlers: {
          GPTBot: "block",
          ClaudeBot: "block",
          PerplexityBot: "allow",
          "Google-Extended": "block",
          CCBot: "block",
        },
        breadcrumbsEnabled: true,
        faqSchemaEnabled: true,
      };

      const robots = generateRobotsTxt(settings, "live", "shop.mysite.com");

      expect(robots).toContain("User-agent: *");
      expect(robots).toContain("Disallow: /cart");
      expect(robots).toContain("Disallow: /checkout");
      expect(robots).toContain("Disallow: /orders/");
      expect(robots).toContain("Disallow: /api/");
      expect(robots).toContain("Disallow: /private/");

      // AI Crawlers
      expect(robots).toContain("User-agent: GPTBot\nDisallow: /");
      expect(robots).toContain("User-agent: ClaudeBot\nDisallow: /");
      expect(robots).toContain("User-agent: Google-Extended\nDisallow: /");
      expect(robots).toContain("User-agent: CCBot\nDisallow: /");
      expect(robots).toContain("User-agent: PerplexityBot\nAllow: /");

      // Sitemap directive
      expect(robots).toContain("Sitemap: https://shop.mysite.com/sitemap.xml");
    });
  });

  describe("getStorefrontSeoSettings", () => {
    it("returns safe defaults when seo_settings row is missing", async () => {
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {},
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: () => [],
                }),
              }),
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const settings = await getStorefrontSeoSettings(rt, publicCtx);

      expect(settings).toEqual({
        indexingEnabled: true,
        titleTemplate: "%s | {{store_name}}",
        defaultMetaDescription: null,
        defaultOgImageMediaId: null,
        twitterHandle: null,
        organizationSchema: null,
        localBusiness: null,
        robotsExtra: null,
        aiCrawlers: {
          GPTBot: "block",
          ClaudeBot: "block",
          PerplexityBot: "block",
          "Google-Extended": "block",
          CCBot: "block",
        },
        breadcrumbsEnabled: true,
        faqSchemaEnabled: true,
      });
    });

    it("returns database row when seo_settings is configured", async () => {
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {},
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: () => [
                    {
                      indexingEnabled: true,
                      titleTemplate: "%s · MyStore",
                      defaultMetaDescription: "Best store ever",
                      defaultOgImageMediaId: "og-1",
                      twitterHandle: "@mystore",
                      organizationSchema: { name: "My Store Inc." },
                      localBusiness: null,
                      robotsExtra: "Disallow: /temp/",
                      aiCrawlers: { GPTBot: "allow" },
                      breadcrumbsEnabled: false,
                      faqSchemaEnabled: true,
                    },
                  ],
                }),
              }),
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const settings = await getStorefrontSeoSettings(rt, publicCtx);

      expect(settings.titleTemplate).toBe("%s · MyStore");
      expect(settings.defaultMetaDescription).toBe("Best store ever");
      expect(settings.breadcrumbsEnabled).toBe(false);
      expect(settings.aiCrawlers).toEqual({ GPTBot: "allow" });
    });
  });
});
