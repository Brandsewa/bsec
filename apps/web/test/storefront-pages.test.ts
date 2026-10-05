import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";

vi.mock("server-only", () => ({}));

import type { BlockInstance } from "@bs/blocks";
import { BlockRenderer } from "../src/components/blocks/BlockRenderer.tsx";
import { fallbackPolicyContent, isValidPolicyType } from "../src/app/policies/[type]/page.tsx";

describe("Storefront Pages & Block Rendering", () => {
  describe("BlockRenderer", () => {
    it("renders Hero block with headline, description, primary & secondary CTA, and background", () => {
      const blocks: BlockInstance[] = [
        {
          id: "hero-1",
          type: "Hero",
          version: 1,
          props: {
            title: "Super Summer Sale",
            subtitle: "Up to 50% off on premium mechanical keyboards",
            ctaText: "Shop Keyboards",
            ctaLink: "/collections/keyboards",
            secondaryCtaText: "Learn More",
            secondaryCtaLink: "/about",
            backgroundMediaId: "media-bg-123",
          },
        },
      ];

      const html = renderToString(React.createElement(BlockRenderer, { blocks }));
      expect(html).toContain("Super Summer Sale");
      expect(html).toContain("Up to 50% off on premium mechanical keyboards");
      expect(html).toContain("Shop Keyboards");
      expect(html).toContain('href="/collections/keyboards"');
      expect(html).toContain("Learn More");
      expect(html).toContain('href="/about"');
    });

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

    it("renders ProductGrid block with title and product links", () => {
      const blocks: BlockInstance[] = [
        {
          id: "grid-1",
          type: "ProductGrid",
          version: 1,
          props: {
            title: "Featured Keyboards",
            subtitle: "Handpicked by our team",
          },
        },
      ];

      const html = renderToString(React.createElement(BlockRenderer, { blocks }));
      expect(html).toContain("Featured Keyboards");
      expect(html).toContain("Handpicked by our team");
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

    it("renders ProductCarousel block with title and carousel container", () => {
      const blocks: BlockInstance[] = [
        {
          id: "car-1",
          type: "ProductCarousel",
          version: 1,
          props: {
            title: "Trending Items",
          },
        },
      ];

      const html = renderToString(React.createElement(BlockRenderer, { blocks }));
      expect(html).toContain("Trending Items");
      expect(html).toContain("bs-block-product-carousel");
    });

    it("renders Testimonials block with quotes and authors", () => {
      const blocks: BlockInstance[] = [
        {
          id: "test-1",
          type: "Testimonials",
          version: 1,
          props: {
            title: "Customer Praise",
            items: [
              {
                quote: "The finest keyboard I have ever typed on.",
                author: "Dev Patel",
                role: "Senior Software Engineer",
              },
            ],
          },
        },
      ];

      const html = renderToString(React.createElement(BlockRenderer, { blocks }));
      expect(html).toContain("Customer Praise");
      expect(html).toContain("The finest keyboard I have ever typed on.");
      expect(html).toContain("Dev Patel");
      expect(html).toContain("Senior Software Engineer");
    });

    it("renders RichText block safely with sanitized HTML", () => {
      const blocks: BlockInstance[] = [
        {
          id: "rich-1",
          type: "RichText",
          version: 1,
          props: {
            content: "<h2>Custom Story</h2><p>Crafted with love in Bangalore.</p>",
          },
        },
      ];

      const html = renderToString(React.createElement(BlockRenderer, { blocks }));
      expect(html).toContain("Custom Story");
      expect(html).toContain("Crafted with love in Bangalore.");
      expect(html).toContain("<h2");
    });

    it("renders FAQ block with questions, answers, and FAQPage JSON-LD schema", () => {
      const blocks: BlockInstance[] = [
        {
          id: "faq-1",
          type: "FAQ",
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

    it("renders Newsletter block with form", () => {
      const blocks: BlockInstance[] = [
        {
          id: "news-1",
          type: "Newsletter",
          version: 1,
          props: {
            title: "Stay In The Loop",
            subtitle: "Subscribe for product drops.",
            buttonText: "Join Club",
            placeholder: "your@email.com",
          },
        },
      ];

      const html = renderToString(React.createElement(BlockRenderer, { blocks }));
      expect(html).toContain("Stay In The Loop");
      expect(html).toContain("Subscribe for product drops.");
      expect(html).toContain("Join Club");
      expect(html).toContain('placeholder="your@email.com"');
    });

    it("renders USP block (UspStrip) with icon items and values", () => {
      const blocks: BlockInstance[] = [
        {
          id: "usp-1",
          type: "UspStrip",
          version: 1,
          props: {
            items: [
              { icon: "Truck", title: "Free Delivery", description: "All orders over ₹999" },
              { icon: "ShieldCheck", title: "Secure Checkout", description: "256-bit SSL encrypted" },
              { icon: "RotateCcw", title: "Easy Returns", description: "7 days refund policy" },
            ],
          },
        },
      ];

      const html = renderToString(React.createElement(BlockRenderer, { blocks }));
      expect(html).toContain("Free Delivery");
      expect(html).toContain("All orders over ₹999");
      expect(html).toContain("Secure Checkout");
      expect(html).toContain("Easy Returns");
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
            type: "Hero" as const,
            version: 1,
            props: {
              title: "Welcome to Our Mechanical Keyboard Emporium",
              subtitle: "Engineered for speed, durability, and tactile perfection.",
              ctaText: "Explore Keyboards",
              ctaLink: "/collections/all",
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
            type: "FAQ" as const,
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
    // Stores have no blog authoring yet, so no store may show demo articles (a pickle shop was showing keyboard guides).
    it("ships no demo articles on the blog index", async () => {
      const { SAMPLE_ARTICLES } = await import("../src/app/blog/page.tsx");
      expect(SAMPLE_ARTICLES).toEqual([]);
    });

    it("has no demo article pages, so every article URL is a 404", async () => {
      const { ARTICLE_DETAILS } = await import("../src/app/blog/[slug]/page.tsx");
      expect(Object.keys(ARTICLE_DETAILS)).toEqual([]);
    });
  });
});
