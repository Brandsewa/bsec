import { describe, expect, it, vi } from "vitest";

// Mock server-only module for vitest execution
vi.mock("server-only", () => ({}));
process.env.DATABASE_URL_RW = process.env.DATABASE_URL_RW ?? "postgres://x:y@127.0.0.1:1/none";

// Mock @bs/domain functions used by route handlers
vi.mock("@bs/domain", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    evaluateStorefrontAccess: vi.fn(),
    getStorefrontSeoSettings: vi.fn(),
    getStorefrontSitemapUrls: vi.fn(),
  };
});

import {
  evaluateStorefrontAccess,
  getStorefrontSeoSettings,
  getStorefrontSitemapUrls,
} from "@bs/domain";

describe("Storefront SEO Endpoints (/robots.txt & /sitemap.xml)", () => {
  describe("GET /robots.txt", () => {
    it("returns Disallow: / with 200 when store is not found / no tenant resolved", async () => {
      vi.mocked(evaluateStorefrontAccess).mockResolvedValueOnce({
        allowed: false,
        httpStatus: 404,
        reason: "not_found",
        status: "not_found",
      });

      const { GET } = await import("../src/app/robots.txt/route.ts");
      const req = new Request("https://unknown.gobs.cloud/robots.txt", {
        headers: { host: "unknown.gobs.cloud" },
      });
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
      const text = await res.text();
      expect(text).toContain("User-agent: *");
      expect(text).toContain("Disallow: /");
    });

    it("blocks all crawlers when tenant is in coming_soon or indexing_enabled is false", async () => {
      vi.mocked(evaluateStorefrontAccess).mockResolvedValueOnce({
        allowed: false,
        httpStatus: 200,
        mode: "coming_soon",
        tenantId: "tenant-cs-1",
        noindex: true,
      });

      vi.mocked(getStorefrontSeoSettings).mockResolvedValueOnce({
        indexingEnabled: true,
        titleTemplate: "%s | Store",
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

      const { GET } = await import("../src/app/robots.txt/route.ts");
      const req = new Request("https://demo.gobs.cloud/robots.txt", {
        headers: { host: "demo.gobs.cloud" },
      });
      const res = await GET(req);

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text.trim()).toBe("User-agent: *\nDisallow: /");
    });

    it("returns custom user-agent rules, disallow rules, AI crawlers, and sitemap directive for live store", async () => {
      vi.mocked(evaluateStorefrontAccess).mockResolvedValueOnce({
        allowed: true,
        httpStatus: 200,
        mode: "live",
        tenantId: "tenant-live-1",
        noindex: false,
      });

      vi.mocked(getStorefrontSeoSettings).mockResolvedValueOnce({
        indexingEnabled: true,
        titleTemplate: "%s | Store",
        defaultMetaDescription: null,
        defaultOgImageMediaId: null,
        twitterHandle: null,
        organizationSchema: null,
        localBusiness: null,
        robotsExtra: "Disallow: /staging/",
        aiCrawlers: {
          GPTBot: "block",
          ClaudeBot: "allow",
          PerplexityBot: "allow",
          "Google-Extended": "block",
          CCBot: "block",
        },
        breadcrumbsEnabled: true,
        faqSchemaEnabled: true,
      });

      const { GET } = await import("../src/app/robots.txt/route.ts");
      const req = new Request("https://shop.example.com/robots.txt", {
        headers: { host: "shop.example.com" },
      });
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(res.headers.get("cache-control")).toBe(
        "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
      );

      const text = await res.text();
      expect(text).toContain("User-agent: *");
      expect(text).toContain("Disallow: /cart");
      expect(text).toContain("Disallow: /checkout");
      expect(text).toContain("Disallow: /orders/");
      expect(text).toContain("Disallow: /api/");
      expect(text).toContain("Disallow: /staging/");
      expect(text).toContain("User-agent: GPTBot\nDisallow: /");
      expect(text).toContain("User-agent: ClaudeBot\nAllow: /");
      expect(text).toContain("Sitemap: https://shop.example.com/sitemap.xml");
    });
  });

  describe("GET /sitemap.xml", () => {
    it("returns empty urlset when tenant is not found", async () => {
      vi.mocked(evaluateStorefrontAccess).mockResolvedValueOnce({
        allowed: false,
        httpStatus: 404,
        reason: "not_found",
        status: "not_found",
      });

      const { GET } = await import("../src/app/sitemap.xml/route.ts");
      const req = new Request("https://unknown.gobs.cloud/sitemap.xml", {
        headers: { host: "unknown.gobs.cloud" },
      });
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
      const xml = await res.text();
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
      expect(xml).toContain("</urlset>");
      expect(xml).not.toContain("<loc>");
    });

    it("returns empty restricted sitemap when indexing is disallowed or store mode is password / maintenance", async () => {
      vi.mocked(evaluateStorefrontAccess).mockResolvedValueOnce({
        allowed: false,
        httpStatus: 200,
        mode: "password",
        tenantId: "tenant-pw-1",
        noindex: true,
      });

      const { GET } = await import("../src/app/sitemap.xml/route.ts");
      const req = new Request("https://demo.gobs.cloud/sitemap.xml", {
        headers: { host: "demo.gobs.cloud" },
      });
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
      const xml = await res.text();
      expect(xml).toContain("<urlset");
      expect(xml).not.toContain("<loc>");
    });

    it("generates valid XML with all published URLs (products, collections, categories, pages, policies, home)", async () => {
      vi.mocked(evaluateStorefrontAccess).mockResolvedValueOnce({
        allowed: true,
        httpStatus: 200,
        mode: "live",
        tenantId: "tenant-live-1",
        noindex: false,
      });

      const dateStr = "2026-09-28T12:00:00.000Z";
      vi.mocked(getStorefrontSitemapUrls).mockResolvedValueOnce([
        { loc: "https://shop.example.com", lastmod: dateStr, changefreq: "daily", priority: 1.0 },
        { loc: "https://shop.example.com/products/custom-board", lastmod: dateStr, changefreq: "weekly", priority: 0.8 },
        { loc: "https://shop.example.com/collections/keyboards", lastmod: dateStr, changefreq: "weekly", priority: 0.7 },
        { loc: "https://shop.example.com/categories/accessories", lastmod: dateStr, changefreq: "weekly", priority: 0.7 },
        { loc: "https://shop.example.com/pages/about-us", lastmod: dateStr, changefreq: "monthly", priority: 0.5 },
        { loc: "https://shop.example.com/blog/mechanical-keyboards-guide-for-beginners", lastmod: dateStr, changefreq: "monthly", priority: 0.6 },
        { loc: "https://shop.example.com/policies/privacy", lastmod: dateStr, changefreq: "yearly", priority: 0.3 },
        { loc: "https://shop.example.com/policies/terms", lastmod: dateStr, changefreq: "yearly", priority: 0.3 },
        { loc: "https://shop.example.com/policies/refund", lastmod: dateStr, changefreq: "yearly", priority: 0.3 },
        { loc: "https://shop.example.com/policies/shipping", lastmod: dateStr, changefreq: "yearly", priority: 0.3 },
      ]);

      const { GET } = await import("../src/app/sitemap.xml/route.ts");
      const req = new Request("https://shop.example.com/sitemap.xml", {
        headers: { host: "shop.example.com" },
      });
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
      expect(res.headers.get("cache-control")).toBe(
        "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
      );

      const xml = await res.text();
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
      expect(xml).toContain("<loc>https://shop.example.com</loc>");
      expect(xml).toContain("<changefreq>daily</changefreq>");
      expect(xml).toContain("<priority>1.0</priority>");

      expect(xml).toContain("<loc>https://shop.example.com/products/custom-board</loc>");
      expect(xml).toContain("<priority>0.8</priority>");

      expect(xml).toContain("<loc>https://shop.example.com/collections/keyboards</loc>");
      expect(xml).toContain("<loc>https://shop.example.com/categories/accessories</loc>");
      expect(xml).toContain("<priority>0.7</priority>");

      expect(xml).toContain("<loc>https://shop.example.com/pages/about-us</loc>");
      expect(xml).toContain("<priority>0.5</priority>");

      expect(xml).toContain("<loc>https://shop.example.com/blog/mechanical-keyboards-guide-for-beginners</loc>");
      expect(xml).toContain("<priority>0.6</priority>");

      expect(xml).toContain("<loc>https://shop.example.com/policies/privacy</loc>");
      expect(xml).toContain("<loc>https://shop.example.com/policies/terms</loc>");
      expect(xml).toContain("<loc>https://shop.example.com/policies/refund</loc>");
      expect(xml).toContain("<loc>https://shop.example.com/policies/shipping</loc>");
      expect(xml).toContain("<priority>0.3</priority>");
    });
  });
});
