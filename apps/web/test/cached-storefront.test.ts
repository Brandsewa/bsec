import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "@bs/domain";

/**
 * What this test proves, and what it deliberately does NOT prove:
 *
 * PROVES: each getCachedStorefront* loader calls next/cache's cacheTag() with exactly the tag
 * strings PLAN §11.6 / packages/domain/src/cache-invalidation.ts's computeInvalidationTags()
 * expects to invalidate later - i.e. the read side and write side agree on tag naming.
 *
 * DOES NOT PROVE: that Next.js's real "use cache" runtime actually caches the function's return
 * value or that revalidateTag() actually purges it. That is genuine framework behavior tied to
 * Next's request-scoped async storage and its own cache handler - it cannot be exercised from a
 * plain vitest process (there is no Next server, no "use cache" compiler transform, no request
 * scope here). Proving that end-to-end requires a running `next build && next start` instance
 * hit over real HTTP with a real mutation in between; that is real work, tracked as a follow-up
 * rather than faked here. Do not reintroduce a hand-rolled cache Map in this file to make that
 * gap "look" closed in a unit test - see git history on this file for why (M3 review round 2/3).
 */

vi.mock("server-only", () => ({}));

const cacheTagCalls: string[] = [];
vi.mock("next/cache", () => ({
  cacheTag: (tag: string) => {
    cacheTagCalls.push(tag);
  },
}));

const TENANT_ID = "018f97b6-1234-7000-8000-000000000001";
const PRODUCT_ID = "018f97b6-2000-7000-8000-000000000001";
const COLLECTION_ID = "018f97b6-2000-7000-8000-000000000002";
const CATEGORY_ID = "018f97b6-2000-7000-8000-000000000003";

vi.mock("../src/server/runtime.ts", () => ({
  server: () => ({
    rt: { service: "web", _db: {} as unknown as Runtime["_db"], close: async () => {} },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }),
}));

vi.mock("@bs/domain", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getStorefrontProduct: vi.fn(async () => ({ id: PRODUCT_ID, slug: "kb" })),
    getStorefrontCollection: vi.fn(async () => ({ collection: { id: COLLECTION_ID, slug: "new" } })),
    getStorefrontCategory: vi.fn(async () => ({ category: { id: CATEGORY_ID, slug: "gadgets" } })),
    getStorefrontHomePage: vi.fn(async () => ({ document: {} })),
    getStorefrontPage: vi.fn(async () => ({ id: "page-1", slug: "about" })),
    getStorefrontPageByPath: vi.fn(async () => ({
      page: { id: "page-2", slug: "team", title: "Team", type: "custom", document: { version: 1, blocks: [] } },
      canonicalPath: "/pages/company/team",
      isCanonical: true,
      breadcrumbs: [{ name: "Home", url: "/" }],
    })),
    getBrandSettings: vi.fn(async () => ({ logoUrl: null })),
  };
});

import {
  getCachedStorefrontProduct,
  getCachedStorefrontCollection,
  getCachedStorefrontCategory,
  getCachedStorefrontHomePage,
  getCachedStorefrontPage,
  getCachedStorefrontPageByPath,
  getCachedBrandSettings,
} from "../src/server/cached-storefront.ts";
import {
  tenantTag,
  getStorefrontProduct,
  getStorefrontCollection,
  getStorefrontCategory,
  getStorefrontPage,
} from "@bs/domain";

describe("cached-storefront read-side tags match the write-side invalidation matrix", () => {
  beforeEach(() => {
    cacheTagCalls.length = 0;
  });

  it("product loader tags with product:{id} and product", async () => {
    await getCachedStorefrontProduct(TENANT_ID, "kb");
    expect(cacheTagCalls).toEqual([
      tenantTag(TENANT_ID, "product"),
      tenantTag(TENANT_ID, "product", PRODUCT_ID),
    ]);
  });

  it("collection loader tags with collection:{id} and collection", async () => {
    await getCachedStorefrontCollection(TENANT_ID, "new");
    expect(cacheTagCalls).toEqual([
      tenantTag(TENANT_ID, "collection"),
      tenantTag(TENANT_ID, "product"),
      tenantTag(TENANT_ID, "collection", COLLECTION_ID),
    ]);
  });

  it("category loader tags with category:{id} and category", async () => {
    await getCachedStorefrontCategory(TENANT_ID, "gadgets");
    expect(cacheTagCalls).toEqual([
      tenantTag(TENANT_ID, "category"),
      tenantTag(TENANT_ID, "product"),
      tenantTag(TENANT_ID, "category", CATEGORY_ID),
    ]);
  });

  // A cached "not found" must carry tags too, otherwise publishing the record later can never clear it
  // (a draft product that is published stayed a 404 until the server restarted).
  it("a product that is not found is still tagged, so publishing it invalidates the cached miss", async () => {
    vi.mocked(getStorefrontProduct).mockResolvedValueOnce(null);
    expect(await getCachedStorefrontProduct(TENANT_ID, "draft-one")).toBeNull();
    expect(cacheTagCalls).toContain(tenantTag(TENANT_ID, "product"));
  });

  it("a collection, category or page that is not found is still tagged", async () => {
    vi.mocked(getStorefrontCollection).mockResolvedValueOnce(null);
    await getCachedStorefrontCollection(TENANT_ID, "missing");
    expect(cacheTagCalls).toContain(tenantTag(TENANT_ID, "collection"));

    cacheTagCalls.length = 0;
    vi.mocked(getStorefrontCategory).mockResolvedValueOnce(null);
    await getCachedStorefrontCategory(TENANT_ID, "missing");
    expect(cacheTagCalls).toContain(tenantTag(TENANT_ID, "category"));

    cacheTagCalls.length = 0;
    vi.mocked(getStorefrontPage).mockResolvedValueOnce(null);
    await getCachedStorefrontPage(TENANT_ID, "missing");
    expect(cacheTagCalls).toEqual([tenantTag(TENANT_ID, "page", "missing"), tenantTag(TENANT_ID, "store-shell")]);
  });

  it("home page loader tags with page:home and store-shell", async () => {
    await getCachedStorefrontHomePage(TENANT_ID);
    expect(cacheTagCalls).toEqual([
      tenantTag(TENANT_ID, "page", "home"),
      tenantTag(TENANT_ID, "store-shell"),
    ]);
  });

  it("custom page loader tags with page:{slug} and store-shell", async () => {
    await getCachedStorefrontPage(TENANT_ID, "about");
    expect(cacheTagCalls).toEqual([
      tenantTag(TENANT_ID, "page", "about"),
      tenantTag(TENANT_ID, "store-shell"),
    ]);
  });

  it("brand settings loader tags with theme, store-shell, and nav", async () => {
    await getCachedBrandSettings(TENANT_ID);
    expect(cacheTagCalls).toEqual([
      tenantTag(TENANT_ID, "theme"),
      tenantTag(TENANT_ID, "store-shell"),
      tenantTag(TENANT_ID, "nav"),
    ]);
  });

  it("custom page by path loader tags with page:{targetSlug} and store-shell", async () => {
    await getCachedStorefrontPageByPath(TENANT_ID, ["company", "team"]);
    expect(cacheTagCalls).toEqual([
      tenantTag(TENANT_ID, "page", "team"),
      tenantTag(TENANT_ID, "store-shell"),
    ]);
  });
});
