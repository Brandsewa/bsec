import { describe, expect, it } from "vitest";
import {
  computeInvalidationTags,
  invalidateCache,
  type CacheChange,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

const TENANT_ID = "018f97b6-1234-7000-8000-000000000001";
const OTHER_TENANT_ID = "018f97b6-1234-7000-8000-000000000002";

const ctx: TenantContext = {
  tenantId: TENANT_ID,
  storeStatus: "live",
  actor: { type: "system" },
  roles: ["store_admin"],
  permissions: ["products.write", "settings.write", "content.write", "theme.publish"],
  requestId: "req-1",
};

describe("PLAN §11.6 Cache Invalidation Matrix", () => {
  it("enforces tenant-prefixed cache tag invariant on all generated tags", () => {
    const changes: CacheChange[] = [
      {
        type: "product_updated",
        productId: "018f97b6-1234-7000-8000-000000000010",
        categoryIds: ["018f97b6-1234-7000-8000-000000000020"],
        collectionIds: ["018f97b6-1234-7000-8000-000000000030"],
        isFeatured: true,
      },
      {
        type: "product_price_changed",
        productId: "018f97b6-1234-7000-8000-000000000010",
        categoryIds: ["018f97b6-1234-7000-8000-000000000020"],
        collectionIds: ["018f97b6-1234-7000-8000-000000000030"],
      },
      {
        type: "product_image_updated",
        productId: "018f97b6-1234-7000-8000-000000000010",
      },
      {
        type: "inventory_out_of_stock_flip",
        productId: "018f97b6-1234-7000-8000-000000000010",
        collectionIds: ["018f97b6-1234-7000-8000-000000000030"],
      },
      { type: "theme_or_brand_published" },
      { type: "home_page_published" },
      { type: "nav_updated" },
      {
        type: "collection_updated",
        collectionId: "018f97b6-1234-7000-8000-000000000030",
      },
      { type: "store_or_seo_updated" },
    ];

    for (const change of changes) {
      const tags = computeInvalidationTags(ctx, change);
      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) {
        expect(tag.startsWith(`t:${TENANT_ID}:`)).toBe(true);
      }
    }
  });

  it("computes exact tags for product price / compare-at price edit", () => {
    const productId = "018f97b6-1234-7000-8000-000000000010";
    const catId = "018f97b6-1234-7000-8000-000000000020";
    const colId = "018f97b6-1234-7000-8000-000000000030";

    const tags = computeInvalidationTags(ctx, {
      type: "product_price_changed",
      productId,
      categoryIds: [catId],
      collectionIds: [colId],
    });

    expect(tags).toEqual([
      `t:${TENANT_ID}:product:${productId}`,
      `t:${TENANT_ID}:product`,
      `t:${TENANT_ID}:category:${catId}`,
      `t:${TENANT_ID}:collection:${colId}`,
    ]);
  });

  it("computes exact tags for product details and SEO update", () => {
    const productId = "018f97b6-1234-7000-8000-000000000010";
    const catId = "018f97b6-1234-7000-8000-000000000020";
    const colId = "018f97b6-1234-7000-8000-000000000030";

    const tags = computeInvalidationTags(ctx, {
      type: "product_updated",
      productId,
      categoryIds: [catId],
      collectionIds: [colId],
      isFeatured: true,
    });

    expect(tags).toEqual([
      `t:${TENANT_ID}:product:${productId}`,
      `t:${TENANT_ID}:product`,
      `t:${TENANT_ID}:category:${catId}`,
      `t:${TENANT_ID}:collection:${colId}`,
      `t:${TENANT_ID}:page:home`,
      `t:${TENANT_ID}:nav`,
    ]);
  });

  it("computes exact tags for theme / brand publish", () => {
    const tags = computeInvalidationTags(ctx, {
      type: "theme_or_brand_published",
    });

    expect(tags).toEqual([
      `t:${TENANT_ID}:theme`,
      `t:${TENANT_ID}:store-shell`,
    ]);
  });

  it("computes exact tags for home page publish", () => {
    const tags = computeInvalidationTags(ctx, {
      type: "home_page_published",
    });

    expect(tags).toEqual([`t:${TENANT_ID}:page:home`]);
  });

  it("computes exact tags for custom page publish / slug change including nav tag", () => {
    const tags = computeInvalidationTags(ctx, {
      type: "page_published",
      slug: "about",
      extraSlugs: ["about-us"],
    });

    expect(tags).toEqual([
      `t:${TENANT_ID}:page:about`,
      `t:${TENANT_ID}:page:about-us`,
      `t:${TENANT_ID}:nav`,
    ]);
  });

  it("computes exact tags for navigation menu update", () => {
    const tags = computeInvalidationTags(ctx, {
      type: "nav_updated",
    });

    expect(tags).toEqual([`t:${TENANT_ID}:nav`]);
  });

  it("computes exact tags for collection update including nav tag", () => {
    const colId = "018f97b6-1234-7000-8000-000000000030";
    const tags = computeInvalidationTags(ctx, {
      type: "collection_updated",
      collectionId: colId,
    });

    expect(tags).toEqual([
      `t:${TENANT_ID}:collection:${colId}`,
      `t:${TENANT_ID}:collection`,
      `t:${TENANT_ID}:page:home`,
      `t:${TENANT_ID}:nav`,
    ]);
  });

  it("computes exact tags for brand update including nav tag", () => {
    const brandId = "018f97b6-1234-7000-8000-000000000040";
    const tags = computeInvalidationTags(ctx, {
      type: "brand_updated",
      brandId,
    });

    expect(tags).toEqual([`t:${TENANT_ID}:nav`]);
  });

  it("computes exact tags for store settings / SEO settings update", () => {
    const tags = computeInvalidationTags(ctx, {
      type: "store_or_seo_updated",
    });

    expect(tags).toEqual([
      `t:${TENANT_ID}:store-shell`,
      `t:${TENANT_ID}:seo`,
    ]);
  });

  it("calls rt.revalidateTags when invalidateCache is invoked", async () => {
    const revalidated: string[][] = [];
    const mockRuntime: Runtime = {
      service: "web",
      _db: {} as unknown as Runtime["_db"],
      revalidateTags: (tags) => {
        revalidated.push(tags);
      },
      close: async () => {},
    };

    const tags = await invalidateCache(mockRuntime, ctx, {
      type: "theme_or_brand_published",
    });

    expect(revalidated).toHaveLength(1);
    expect(revalidated[0]).toEqual([
      `t:${TENANT_ID}:theme`,
      `t:${TENANT_ID}:store-shell`,
    ]);
    expect(tags).toEqual(revalidated[0]);
  });

  it("never mixes tags across different tenants", () => {
    const tagsA = computeInvalidationTags(TENANT_ID, { type: "theme_or_brand_published" });
    const tagsB = computeInvalidationTags(OTHER_TENANT_ID, { type: "theme_or_brand_published" });

    for (const tag of tagsA) {
      expect(tag.startsWith(`t:${TENANT_ID}:`)).toBe(true);
      expect(tag.startsWith(`t:${OTHER_TENANT_ID}:`)).toBe(false);
    }
    for (const tag of tagsB) {
      expect(tag.startsWith(`t:${OTHER_TENANT_ID}:`)).toBe(true);
      expect(tag.startsWith(`t:${TENANT_ID}:`)).toBe(false);
    }
  });
});
