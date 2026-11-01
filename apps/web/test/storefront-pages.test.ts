import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";

vi.mock("server-only", () => ({}));

import type { BlockInstance } from "@bs/blocks";
import { BlockRenderer } from "../src/components/blocks/BlockRenderer.tsx";
import { fallbackPolicyContent, isValidPolicyType } from "../src/app/policies/[type]/page.tsx";

describe("Storefront Pages & Block Rendering", () => {
  describe("BlockRenderer", () => {
    it("renders Banner block with headline/text and link", () => {
      const blocks: BlockInstance[] = [
        {
          id: "banner-1",
          type: "Banner",
          version: 1,
          props: {
            text: "Free shipping across India on orders over ₹999!",
            link: "/policies/shipping",
          },
        },
      ];

      const html = renderToString(React.createElement(BlockRenderer, { blocks }));
      expect(html).toContain("Free shipping across India on orders over ₹999!");
      expect(html).toContain('href="/policies/shipping"');
    });

    it("renders CollectionGrid block with title and category grid", () => {
      const blocks: BlockInstance[] = [
        {
          id: "col-1",
          type: "CollectionGrid",
          version: 1,
          props: {
            title: "Shop by Category",
            columns: "3",
          },
        },
      ];

      const html = renderToString(React.createElement(BlockRenderer, { blocks }));
      expect(html).toContain("Shop by Category");
      expect(html).toContain("bs-block-collection-grid");
    });

    it("renders FAQ accordion block with questions, answers, and FAQPage JSON-LD schema", () => {
      const blocks: BlockInstance[] = [
        {
          id: "faq-1",
          type: "FaqSection",
          version: 1,
          props: {
            title: "Frequently Asked Questions",
            items: [
              {
                question: "Do you ship internationally?",
                answer: "Currently we only ship within India.",
              },
            ],
          },
        },
      ];

      const html = renderToString(React.createElement(BlockRenderer, { blocks }));
      expect(html).toContain("Frequently Asked Questions");
      expect(html).toContain("Do you ship internationally?");
      expect(html).toContain("Currently we only ship within India.");
      expect(html).toContain('application/ld+json');
      expect(html).toContain('"@type":"FAQPage"');
      expect(html).toContain("Do you ship internationally?");
    });

  });

  describe("Policy Page Routing Logic", () => {
    it("validates allowed policy types", () => {
      expect(isValidPolicyType("privacy")).toBe(true);
      expect(isValidPolicyType("terms")).toBe(true);
      expect(isValidPolicyType("refund")).toBe(true);
      expect(isValidPolicyType("shipping")).toBe(true);
      expect(isValidPolicyType("unknown")).toBe(false);
      expect(isValidPolicyType("cookie")).toBe(false);
    });

    it("provides fallback content and metadata for all valid policies", () => {
      for (const type of ["privacy", "terms", "refund", "shipping"] as const) {
        const policy = fallbackPolicyContent[type];
        expect(policy).toBeDefined();
        expect(policy.title.length).toBeGreaterThan(0);
        expect(policy.body.length).toBeGreaterThan(0);
        expect(policy.lastUpdated).toBeDefined();
      }
    });
  });

  describe("Home Page Block Document Integration", () => {
    it("validates and renders home page block document via renderBlockDocument", async () => {
      const { renderBlockDocument } = await import("@bs/blocks");
      const sampleDoc = {
        version: 1 as const,
        blocks: [
          {
            id: "hero-home",
            type: "Heading" as const,
            version: 1,
            props: {
              text: "Welcome to Our Mechanical Keyboard Emporium",
            },
          },
          {
            id: "hidden-banner",
            type: "Banner" as const,
            version: 1,
            hidden: true,
            props: {
              text: "Old announcement",
            },
          },
          {
            id: "faq-home",
            type: "FaqSection" as const,
            version: 1,
            props: {
              title: "Customer Questions",
              items: [
                { question: "What is your warranty?", answer: "All keyboards come with 2-year warranty." },
              ],
            },
          },
        ],
      };

      const result = renderBlockDocument(sampleDoc);
      expect(result.success).toBe(true);
      expect(result.blocks).toHaveLength(2); // Hidden block filtered out

      const html = renderToString(React.createElement(BlockRenderer, { blocks: result.blocks }));
      expect(html).toContain("Welcome to Our Mechanical Keyboard Emporium");
      expect(html).toContain("Customer Questions");
      expect(html).not.toContain("Old announcement");
    });
  });

  describe("Blog Routes", () => {
    const root = join(process.cwd(), "src/app/blog");
    const pages = ["page.tsx", "page/[n]/page.tsx", "category/[...path]/page.tsx", "[slug]/page.tsx"];

    it("has the archive, page, category and post routes, each with a loading.tsx beside it", () => {
      for (const page of pages) {
        expect(existsSync(join(root, page)), page).toBe(true);
        expect(existsSync(join(root, page.replace(/page\.tsx$/, "loading.tsx"))), `${page} loading`).toBe(true);
      }
      expect(existsSync(join(root, "feed.xml/route.ts"))).toBe(true);
    });

    it("no longer carries demo articles: posts come from the store", () => {
      for (const page of pages) {
        const src = readFileSync(join(root, page), "utf8");
        expect(src).not.toContain("SAMPLE_ARTICLES");
        expect(src).not.toContain("ARTICLE_DETAILS");
      }
    });

    it("lists page numbers with the first, last and neighbours of the current page", async () => {
      const { pageWindow } = await import("../src/components/blog/BlogListingSection.tsx");
      expect(pageWindow(1, 1)).toEqual([1]);
      expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
      expect(pageWindow(5, 10)).toEqual([1, "gap", 4, 5, 6, "gap", 10]);
      expect(pageWindow(2, 10)).toEqual([1, 2, 3, "gap", 10]);
    });
  });
});
