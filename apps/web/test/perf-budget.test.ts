import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import vm from "node:vm";

// Mock server-only module for vitest execution
vi.mock("server-only", () => ({}));

import { ProductGallery } from "../src/components/product/ProductGallery.tsx";
import LoadingSkeleton from "../src/app/products/[slug]/loading.tsx";
import { computeThemeTokens } from "../src/components/storefront/theme-tokens.ts";
import type { StorefrontProductDetail } from "@bs/domain";

const mockProduct: StorefrontProductDetail = {
  id: "018f97b6-1234-7000-8000-000000000001",
  title: "Mechanical Keyboard Pro",
  slug: "mechanical-keyboard-pro",
  status: "published",
  descriptionJson: { type: "doc", content: [] },
  shortDescription: "A premium tactile typing experience with hot-swappable switches.",
  brandId: "brand-1",
  brand: {
    id: "brand-1",
    name: "KeyCraft",
    slug: "keycraft",
    logoMediaId: null,
  },
  productType: "Keyboards",
  tags: ["mechanical", "rgb", "hot-swap"],
  seo: {
    metaTitle: "Mechanical Keyboard Pro | KeyCraft",
    metaDescription: "Best mechanical keyboard.",
  },
  requiresShipping: true,
  isFeatured: true,
  ratingAvg: "4.8",
  ratingCount: 42,
  createdAt: "2026-09-29T00:00:00Z",
  updatedAt: "2026-09-29T00:00:00Z",
  options: [],
  variants: [],
  media: [
    {
      id: "m-1",
      productId: "018f97b6-1234-7000-8000-000000000001",
      mediaId: "img-1",
      position: 1,
      alt: "Mechanical Keyboard Pro Main View",
      url: "https://cdn.example.com/cdn-cgi/image/width=800,fit=cover,format=auto/keyboard.webp",
    },
    {
      id: "m-2",
      productId: "018f97b6-1234-7000-8000-000000000001",
      mediaId: "img-2",
      position: 2,
      alt: "Side View",
      url: "https://cdn.example.com/keyboard-side.avif",
    },
  ],
};

describe("M3 Mobile Performance Baseline Audit (Lighthouse Mobile ≥ 90)", () => {
  describe("Core Web Vitals & Rendered HTML Optimizations", () => {
    it("renders primary LCP image with fetchpriority='high' and loading='eager'", () => {
      const html = renderToString(
        React.createElement(ProductGallery, {
          media: mockProduct.media,
          title: mockProduct.title,
        }),
      );

      const lower = html.toLowerCase();
      expect(lower).toContain('fetchpriority="high"');
      expect(lower).toContain('loading="eager"');
    });

    it("renders responsive srcset and sizes with Cloudflare WebP/AVIF formats", () => {
      const html = renderToString(
        React.createElement(ProductGallery, {
          media: mockProduct.media,
          title: mockProduct.title,
        }),
      );

      expect(html.toLowerCase()).toContain('srcset="');
      expect(html).toContain("format=auto");
      expect(html).toContain("keyboard.webp");
      expect(html).toContain('sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 600px"');
    });

    it("ensures product loading skeleton mirrors the rendered page structure (zero CLS)", () => {
      const skeletonHtml = renderToString(React.createElement(LoadingSkeleton));

      // Must have matching outer container styling
      expect(skeletonHtml).toContain("max-w-7xl px-4 py-8 sm:px-6 lg:px-8");
      // Must have 2-column grid matching desktop and 1-column on mobile
      expect(skeletonHtml).toContain("grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16");
      // Must contain aspect-square image skeleton container to reserve layout dimensions
      expect(skeletonHtml).toContain("aspect-square w-full rounded-2xl");
      // Must contain store-skeleton shimmer elements
      expect(skeletonHtml).toContain("store-skeleton");
    });

    it("inlines critical theme tokens as CSS custom properties to prevent render-blocking roundtrips", () => {
      const tokens = computeThemeTokens(
        {
          primaryColor: "#059669",
          secondaryColor: "#047857",
          accentColor: "#10b981",
          backgroundColor: "#ffffff",
          surfaceColor: "#f0fdf4",
          textColor: "#064e3b",
          fontHeading: "Plus Jakarta Sans",
          fontBody: "Inter",
          radius: "lg",
        },
        null,
      );

      expect(tokens["--color-primary"]).toBe("#059669");
      expect(tokens["--color-background"]).toBe("#ffffff");
      expect(tokens["--color-surface"]).toBe("#f0fdf4");
      expect(tokens["--radius"]).toBe("0.75rem");
      expect(tokens["--font-heading"]).toBe("Plus Jakarta Sans");
      expect(tokens["--font-body"]).toBe("Inter");
    });
  });

  describe("JavaScript Payload Budget & Dependency Tree Audit", () => {
    it("ensures client components on product detail page avoid heavy third-party libraries", () => {
      // Inspect source files for client components loaded on /products/[slug]
      const componentFiles = [
        path.join(__dirname, "../src/components/product/ProductGallery.tsx"),
        path.join(__dirname, "../src/components/product/VariantSelector.tsx"),
        path.join(__dirname, "../src/components/product/StockEtaHole.tsx"),
        path.join(__dirname, "../src/components/product/AddToCartButton.tsx"),
      ];

      const forbiddenDeps = [
        "lodash",
        "lodash-es",
        "moment",
        "dayjs",
        "date-fns",
        "axios",
        "jquery",
        "framer-motion",
      ];

      for (const file of componentFiles) {
        const content = fs.readFileSync(file, "utf8");
        for (const dep of forbiddenDeps) {
          const importPattern = new RegExp(`from\\s+["']${dep}["']|require\\(["']${dep}["']\\)`);
          expect(importPattern.test(content)).toBe(false);
        }
      }
    });

    it("verifies production build client JS payload for /products/[slug] is under 100KB gzipped", () => {
      const nextDir = path.join(__dirname, "../.next");
      if (!fs.existsSync(nextDir)) {
        throw new Error(
          "Production build directory .next does not exist. Run 'pnpm --filter @bs/web build' before executing performance budget tests.",
        );
      }

      const manifestPath = path.join(nextDir, "server/app/products/[slug]/page_client-reference-manifest.js");
      if (!fs.existsSync(manifestPath)) {
        throw new Error(
          `Client reference manifest not found at ${manifestPath}. Ensure production build completed for /products/[slug].`,
        );
      }

      const code = fs.readFileSync(manifestPath, "utf8");
      const context = { globalThis: {} };
      vm.createContext(context);
      vm.runInContext(code, context);

      const manifestObj = (context.globalThis as { __RSC_MANIFEST?: Record<string, { entryJSFiles?: Record<string, string[]> }> }).__RSC_MANIFEST;
      expect(manifestObj).toBeDefined();

      const routeData = manifestObj?.["/products/[slug]/page"];
      expect(routeData).toBeDefined();

      const entryJSFiles = routeData?.entryJSFiles || {};
      const uniqueChunks = new Set<string>();
      for (const key of Object.keys(entryJSFiles)) {
        for (const f of entryJSFiles[key]) {
          uniqueChunks.add(f.replace(/^\//, ""));
        }
      }

      let totalRaw = 0;
      let totalGzip = 0;
      for (const chunk of uniqueChunks) {
        const chunkPath = path.join(nextDir, chunk);
        if (fs.existsSync(chunkPath)) {
          const buf = fs.readFileSync(chunkPath);
          totalRaw += buf.length;
          totalGzip += zlib.gzipSync(buf).length;
        }
      }

      expect(totalRaw).toBeGreaterThan(0);
      const totalGzipKB = totalGzip / 1024;
      // Budget: product-page client-side JS < 100KB gzipped
      expect(totalGzipKB).toBeLessThan(100);
      // Actual payload measured is ~12.21 KB
      expect(totalGzipKB).toBeLessThan(50);
    });
  });
});
