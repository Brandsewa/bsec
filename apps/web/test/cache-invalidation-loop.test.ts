import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { Runtime } from "@bs/domain";

// Mock server-only
vi.mock("server-only", () => ({}));

// Mock next/headers
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (key: string) => {
      if (key.toLowerCase() === "host") return "teststore.gobs.cloud";
      return null;
    },
  }),
}));

const revalidatedTags: string[] = [];

// Mock server runtime
vi.mock("../src/server/runtime.ts", () => ({
  server: () => ({
    rt: {
      service: "web",
      _db: {} as unknown as Runtime["_db"],
      revalidateTags: (tags: string[]) => {
        invalidateStorefrontCache(tags);
        for (const t of tags) {
          revalidatedTags.push(t);
        }
      },
      close: async () => {},
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  }),
}));

// Mock next/cache
vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
  revalidateTag: vi.fn((tag: string) => {
    revalidatedTags.push(tag);
  }),
}));

import {
  computeInvalidationTags,
  invalidateCache,
  tenantTag,
  type StorefrontProductDetail,
} from "@bs/domain";
import {
  clearStorefrontCache,
  getCachedStorefrontProduct,
  getStorefrontCacheSize,
  invalidateStorefrontCache,
} from "../src/server/cached-storefront.ts";
import ProductDetailPage from "../src/app/products/[slug]/page.tsx";

const TENANT_ID = "018f97b6-1234-7000-8000-000000000001";
const PRODUCT_ID = "018f97b6-2000-7000-8000-000000000001";
const VARIANT_ID = "018f97b6-3000-7000-8000-000000000001";

// Live state mutable by admin actions
let currentPricePaise = 99900; // ₹999.00

const liveProduct: StorefrontProductDetail = {
  id: PRODUCT_ID,
  title: "Mechanical Keyboard Pro",
  slug: "mechanical-keyboard-pro",
  status: "published",
  descriptionJson: { type: "doc", content: [] },
  shortDescription: "A premium tactile typing experience.",
  brandId: null,
  brand: null,
  productType: "Keyboard",
  tags: ["gadgets"],
  seo: null,
  requiresShipping: true,
  isFeatured: true,
  ratingAvg: "4.8",
  ratingCount: 12,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  options: [],
  media: [],
  variants: [
    {
      id: VARIANT_ID,
      productId: PRODUCT_ID,
      sku: "MKP-01",
      barcode: null,
      title: "Default Variant",
      optionValues: null,
      price: currentPricePaise,
      compareAtPrice: 129900,
      trackInventory: true,
      allowBackorder: false,
      position: 1,
      imageMediaId: null,
      stockStatus: "in_stock",
      availableQuantity: 10,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
};

// Mock getStorefrontProduct from @bs/domain to return the current live product with live price
vi.mock("@bs/domain", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    evaluateStorefrontAccess: vi.fn(async () => ({
      allowed: true,
      httpStatus: 200,
      mode: "live",
      tenantId: TENANT_ID,
    })),
    getStorefrontProduct: vi.fn(async () => ({
      ...liveProduct,
      variants: [
        {
          ...liveProduct.variants[0]!,
          price: currentPricePaise,
        },
      ],
    })),
  };
});

describe("Cache Invalidation End-to-End Loop (PLAN §11.6 & §10)", () => {
  beforeEach(() => {
    clearStorefrontCache();
    revalidatedTags.length = 0;
    currentPricePaise = 99900;
  });

  it("closes the loop: read (cached) -> admin price mutation -> revalidateTag() -> read reflects new price", async () => {
    // -------------------------------------------------------------
    // Step 1: Initial Read - Cache is cold
    // -------------------------------------------------------------
    expect(getStorefrontCacheSize()).toBe(0);

    const initialProduct = await getCachedStorefrontProduct(TENANT_ID, "mechanical-keyboard-pro");
    expect(initialProduct).not.toBeNull();
    expect(initialProduct?.variants[0]?.price).toBe(99900);
    expect(getStorefrontCacheSize()).toBe(1);

    // Render Product Detail Page with initial price (₹999)
    const initialHtml = renderToString(
      await ProductDetailPage({
        params: Promise.resolve({ slug: "mechanical-keyboard-pro" }),
      }),
    );
    expect(initialHtml).toContain("₹999");
    expect(initialHtml).not.toContain("₹1,499");

    console.log("[CACHE TEST STEP 1] Initial Read (Cold Cache):");
    console.log(`  Price: ₹${initialProduct!.variants[0]!.price / 100} (paise: ${initialProduct!.variants[0]!.price})`);
    console.log(`  Cache size: ${getStorefrontCacheSize()}`);
    console.log(`  Rendered HTML snippet includes: "₹999"`);

    // -------------------------------------------------------------
    // Step 2: Simulate Database Price Change WITHOUT Cache Invalidation
    // -------------------------------------------------------------
    currentPricePaise = 149900; // Price increased to ₹1,499 in Postgres database

    // Read again without invalidation: must return STALE cached price ₹999
    const cachedProduct = await getCachedStorefrontProduct(TENANT_ID, "mechanical-keyboard-pro");
    expect(cachedProduct?.variants[0]?.price).toBe(99900); // STILL OLD PRICE!

    const cachedHtml = renderToString(
      await ProductDetailPage({
        params: Promise.resolve({ slug: "mechanical-keyboard-pro" }),
      }),
    );
    expect(cachedHtml).toContain("₹999");
    expect(cachedHtml).not.toContain("₹1,499");

    console.log("[CACHE TEST STEP 2] Read After DB Update (Before Invalidation - Cache Hit):");
    console.log(`  DB price is now: ₹${currentPricePaise / 100}`);
    console.log(`  Cached read returned: ₹${cachedProduct!.variants[0]!.price / 100} (Stale cache served correctly)`);

    // -------------------------------------------------------------
    // Step 3: Admin Path - Price Mutation Triggers Cache Invalidation
    // -------------------------------------------------------------
    const mockRuntime = {
      service: "web" as const,
      _db: {} as unknown as Runtime["_db"],
      revalidateTags: (tags: string[]) => {
        invalidateStorefrontCache(tags);
        for (const t of tags) {
          revalidatedTags.push(t);
        }
      },
      close: async () => {},
    };

    const adminCtx = {
      tenantId: TENANT_ID,
      storeStatus: "live" as const,
      actor: { type: "system" as const },
      roles: ["store_admin"],
      permissions: ["products.write", "settings.write"],
      requestId: "req-admin-1",
    };

    // Compute tags and trigger invalidation via domain matrix
    const computedTags = computeInvalidationTags(adminCtx, {
      type: "product_price_changed",
      productId: PRODUCT_ID,
    });

    const expectedProductTag = tenantTag(TENANT_ID, "product", PRODUCT_ID);
    const expectedGlobalProductTag = tenantTag(TENANT_ID, "product");

    expect(computedTags).toContain(expectedProductTag);
    expect(computedTags).toContain(expectedGlobalProductTag);

    // Call invalidateCache
    await invalidateCache(mockRuntime, adminCtx, {
      type: "product_price_changed",
      productId: PRODUCT_ID,
    });

    expect(revalidatedTags).toContain(expectedProductTag);
    expect(revalidatedTags).toContain(expectedGlobalProductTag);
    expect(getStorefrontCacheSize()).toBe(0); // Cache entry was purged!

    console.log("[CACHE TEST STEP 3] Admin Mutation Fired Invalidation:");
    console.log(`  Invalidated tags: ${JSON.stringify(revalidatedTags)}`);
    console.log(`  Cache size after purge: ${getStorefrontCacheSize()}`);

    // -------------------------------------------------------------
    // Step 4: Subsequent Read - Cache Miss, Fresh Data Loaded
    // -------------------------------------------------------------
    const updatedProduct = await getCachedStorefrontProduct(TENANT_ID, "mechanical-keyboard-pro");
    expect(updatedProduct?.variants[0]?.price).toBe(149900); // NEW PRICE ₹1,499!
    expect(getStorefrontCacheSize()).toBe(1);

    // Render Product Detail Page after invalidation
    const updatedHtml = renderToString(
      await ProductDetailPage({
        params: Promise.resolve({ slug: "mechanical-keyboard-pro" }),
      }),
    );
    expect(updatedHtml).toContain("₹1,499");
    expect(updatedHtml).not.toContain("₹999");

    console.log("[CACHE TEST STEP 4] Read After Invalidation (Cache Refreshed):");
    console.log(`  Price: ₹${updatedProduct!.variants[0]!.price / 100} (paise: ${updatedProduct!.variants[0]!.price})`);
    console.log(`  Rendered HTML now contains: "₹1,499"`);
    console.log("[SUCCESS] Cache invalidation loop closed and verified end-to-end!");
  });
});
