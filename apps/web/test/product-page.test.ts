import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";

// Mock server-only module for vitest execution
vi.mock("server-only", () => ({}));

import { ProductGallery } from "../src/components/product/ProductGallery.tsx";
import { VariantSelector } from "../src/components/product/VariantSelector.tsx";
import { StockEtaHole, StockEtaSkeleton } from "../src/components/product/StockEtaHole.tsx";
import { AddToCartButton } from "../src/components/product/AddToCartButton.tsx";
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
  options: [
    {
      id: "opt-switch",
      productId: "018f97b6-1234-7000-8000-000000000001",
      name: "Switch Type",
      position: 1,
      values: ["Red Linear", "Brown Tactile", "Blue Clicky"],
    },
    {
      id: "opt-color",
      productId: "018f97b6-1234-7000-8000-000000000001",
      name: "Color",
      position: 2,
      values: ["Midnight Black", "Arctic White"],
    },
  ],
  variants: [
    {
      id: "018f97b6-2000-7000-8000-000000000001",
      productId: "018f97b6-1234-7000-8000-000000000001",
      sku: "KC-PRO-BLK-RED",
      barcode: "8901234567890",
      title: "Red Linear / Midnight Black",
      optionValues: {
        "Switch Type": "Red Linear",
        Color: "Midnight Black",
      },
      price: 899900, // ₹8,999.00
      compareAtPrice: 1099900, // ₹10,999.00 (Savings!)
      trackInventory: true,
      allowBackorder: false,
      position: 1,
      imageMediaId: "img-blk-red",
      stockStatus: "in_stock",
      availableQuantity: 15,
      createdAt: "2026-09-29T00:00:00Z",
      updatedAt: "2026-09-29T00:00:00Z",
    },
    {
      id: "018f97b6-2000-7000-8000-000000000002",
      productId: "018f97b6-1234-7000-8000-000000000001",
      sku: "KC-PRO-WHT-BRN",
      barcode: "8901234567891",
      title: "Brown Tactile / Arctic White",
      optionValues: {
        "Switch Type": "Brown Tactile",
        Color: "Arctic White",
      },
      price: 949900, // ₹9,499.00
      compareAtPrice: 949900,
      trackInventory: true,
      allowBackorder: false,
      position: 2,
      imageMediaId: "img-wht-brn",
      stockStatus: "low_stock",
      availableQuantity: 3,
      createdAt: "2026-09-29T00:00:00Z",
      updatedAt: "2026-09-29T00:00:00Z",
    },
    {
      id: "018f97b6-2000-7000-8000-000000000003",
      productId: "018f97b6-1234-7000-8000-000000000001",
      sku: "KC-PRO-BLK-BLU",
      barcode: "8901234567892",
      title: "Blue Clicky / Midnight Black",
      optionValues: {
        "Switch Type": "Blue Clicky",
        Color: "Midnight Black",
      },
      price: 899900,
      trackInventory: true,
      allowBackorder: false,
      position: 3,
      imageMediaId: null,
      stockStatus: "out_of_stock",
      availableQuantity: 0,
      createdAt: "2026-09-29T00:00:00Z",
      updatedAt: "2026-09-29T00:00:00Z",
    },
  ],
  media: [
    {
      id: "m-1",
      productId: "018f97b6-1234-7000-8000-000000000001",
      mediaId: "img-blk-red",
      position: 1,
      alt: "Mechanical Keyboard Pro Front View",
      url: "https://images.example.com/keyboard-front.webp",
    },
    {
      id: "m-2",
      productId: "018f97b6-1234-7000-8000-000000000001",
      mediaId: "img-wht-brn",
      position: 2,
      alt: "Mechanical Keyboard Pro Side View",
      url: "https://images.example.com/keyboard-side.webp",
    },
  ],
};

describe("Storefront Product Detail Page (/products/[slug])", () => {
  describe("ProductGallery", () => {
    it("renders main image with fetchpriority high for LCP and responsive thumbnails", () => {
      const html = renderToString(
        React.createElement(ProductGallery, {
          media: mockProduct.media,
          title: mockProduct.title,
        }),
      );

      // Contains main image with fetchPriority="high" or priority attribute
      expect(html.toLowerCase()).toContain('fetchpriority="high"');
      expect(html).toContain("https://images.example.com/keyboard-front.webp");
      expect(html).toContain("Mechanical Keyboard Pro Front View");

      // Contains thumbnail strip for navigation
      expect(html).toContain("https://images.example.com/keyboard-side.webp");
      expect(html).toContain("Mechanical Keyboard Pro Side View");
    });

    it("renders fallback image container when no media is present", () => {
      const html = renderToString(
        React.createElement(ProductGallery, {
          media: [],
          title: "Product Without Image",
        }),
      );

      expect(html).toContain("No image available");
    });
  });

  describe("VariantSelector", () => {
    it("renders options, prices in ₹ / paise, SKU, and savings badge", () => {
      const html = renderToString(
        React.createElement(VariantSelector, {
          product: mockProduct,
        }),
      );

      // Option groups
      expect(html).toContain("Switch Type");
      expect(html).toContain("Red Linear");
      expect(html).toContain("Brown Tactile");
      expect(html).toContain("Color");
      expect(html).toContain("Midnight Black");
      expect(html).toContain("Arctic White");

      // Price formatted in INR (₹8,999 or ₹8,999.00)
      expect(html).toContain("₹8,999");
      // Compare-at price savings
      expect(html).toContain("₹10,999");
      expect(html).toContain("Save");

      // SKU of active variant
      expect(html).toContain("KC-PRO-BLK-RED");
    });
  });

  describe("StockEtaHole", () => {
    it("renders In Stock badge, GST note, and pincode check input", () => {
      const html = renderToString(
        React.createElement(StockEtaHole, {
          stockStatus: "in_stock",
          availableQuantity: 15,
        }),
      );

      expect(html).toContain("In Stock");
      expect(html).toContain("Price incl. of all taxes");
      expect(html).toMatch(/Delivery &amp; Services|Delivery & Services/);
      expect(html).toContain('placeholder="Enter 6-digit Pincode"');
      expect(html).toContain("Check");
    });

    it("renders low stock badge when quantity is low", () => {
      const html = renderToString(
        React.createElement(StockEtaHole, {
          stockStatus: "low_stock",
          availableQuantity: 3,
        }),
      );

      expect(html).toMatch(/Only <!-- -->3<!-- --> left!|Only 3 left!/);
    });

    it("renders Out of Stock badge when out of stock", () => {
      const html = renderToString(
        React.createElement(StockEtaHole, {
          stockStatus: "out_of_stock",
          availableQuantity: 0,
        }),
      );

      expect(html).toContain("Out of Stock");
    });

    it("renders StockEtaSkeleton with zero layout shift", () => {
      const html = renderToString(React.createElement(StockEtaSkeleton));
      expect(html).toContain("store-skeleton");
    });
  });

  describe("AddToCartButton", () => {
    it("renders enabled button when variant is in stock", () => {
      const html = renderToString(
        React.createElement(AddToCartButton, {
          variantId: mockProduct.variants[0]!.id,
          available: true,
        }),
      );

      expect(html).toContain("Add to Cart");
      expect(html).not.toContain("disabled");
    });

    it("renders disabled state when variant is out of stock", () => {
      const html = renderToString(
        React.createElement(AddToCartButton, {
          variantId: mockProduct.variants[2]!.id,
          available: false,
        }),
      );

      expect(html).toContain("Out of Stock");
      expect(html).toContain("disabled");
    });
  });

  describe("Product Detail Page SSR & Schema.org JSON-LD", () => {
    it("emits Schema.org Product JSON-LD with variants, offers, brand, and rating", async () => {
      const { generateProductJsonLd, generateBreadcrumbJsonLd } = await import("@bs/domain");
      const jsonLd = generateProductJsonLd(mockProduct, "https://keycraft.store");

      expect(jsonLd["@type"]).toBe("Product");
      expect(jsonLd.name).toBe("Mechanical Keyboard Pro");
      expect(jsonLd.brand?.name).toBe("KeyCraft");
      expect(jsonLd.offers).toHaveLength(3);
      expect(jsonLd.offers?.[0]?.price).toBe(899900);
      expect(jsonLd.offers?.[0]?.availability).toBe("https://schema.org/InStock");
      expect(jsonLd.offers?.[2]?.availability).toBe("https://schema.org/OutOfStock");
      expect(jsonLd.aggregateRating?.ratingValue).toBe("4.8");
      expect(jsonLd.aggregateRating?.reviewCount).toBe(42);

      const breadcrumbLd = generateBreadcrumbJsonLd([
        { name: "Home", url: "https://keycraft.store" },
        { name: "Products", url: "https://keycraft.store/products" },
        { name: mockProduct.title, url: `https://keycraft.store/products/${mockProduct.slug}` },
      ]);
      expect(breadcrumbLd["@type"]).toBe("BreadcrumbList");
      expect(breadcrumbLd.itemListElement).toHaveLength(3);
    });
  });
});
