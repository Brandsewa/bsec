import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { and, eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { BlockInstance } from "@bs/blocks";
import {
  createMenu,
  createPage,
  createRuntime,
  deleteMenu,
  deletePage,
  getMenu,
  getStorefrontCollection,
  listMenus,
  provisionTenant,
  publishPage,
  resolvePageRenderData,
  tenantTag,
  updateMenu,
  updatePage,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
let ctxA: TenantContext;

const ctxFor = (tenantId: string, ownerId: string): TenantContext => ({
  tenantId,
  storeStatus: "live",
  actor: { type: "staff", userId: ownerId },
  roles: ["store_owner"],
  permissions: ["content.read", "content.write", "theme.publish", "products.write"],
  requestId: "req_storefront_menus_test",
});

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });

  const a = await provisionTenant(rt, {
    storeName: "menus-tenant-a",
    slug: "menus-tenant-a",
    owner: { email: "owner-menus@test.com", name: "Owner Menus" },
    planCode: "starter",
    source: "platform_admin",
  });

  ctxA = ctxFor(a.tenantId, a.ownerId);
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await env?.stop();
});

describe("storefront menu resolution in resolvePageRenderData (Slice A)", () => {
  it("resolves dynamic menu targets at render time and skips dead targets", async () => {
    // 1. Create hierarchical published pages
    const parent = await createPage(rt, ctxA, {
      title: "Company",
      slug: "company",
    });
    await publishPage(rt, ctxA, { id: parent.id });

    const child = await createPage(rt, ctxA, {
      title: "About Us",
      slug: "about-us",
      parentId: parent.id,
    });
    await publishPage(rt, ctxA, { id: child.id });

    // 2. Create an unpublished page (dead target)
    const draftPage = await createPage(rt, ctxA, {
      title: "Secret Draft",
      slug: "secret-draft",
    });

    // 3. Create a published collection in the database
    const colId = crypto.randomUUID();
    await withTenant(rt._db.db, ctxA.tenantId, async (tx) => {
      await tx.insert(schema.collections).values({
        id: colId,
        tenantId: ctxA.tenantId,
        title: "Summer Wear",
        slug: "summer-wear",
        published: true,
      });
    });

    // 4. Update or insert header menu in schema.menus
    const menuItems = [
      { id: "m1", title: "Home", type: "home", url: "/" },
      { id: "m2", title: "About", type: "page", targetId: child.id, url: "/pages/about-us" },
      { id: "m3", title: "Summer", type: "collection", targetId: colId, url: "/collections/summer-wear" },
      { id: "m4", title: "Draft", type: "page", targetId: draftPage.id, url: "/pages/secret-draft" }, // dead target (draft)
      { id: "m5", title: "NonExistent", type: "page", targetId: crypto.randomUUID(), url: "/pages/gone" }, // dead target (not found)
      { id: "m6", title: "External", type: "url", url: "https://example.com", openInNewTab: true },
      { id: "m7", title: "Malicious", type: "url", url: "javascript:alert(1)" }, // unsafe scheme: skip
    ];

    await withTenant(rt._db.db, ctxA.tenantId, async (tx) => {
      const [existing] = await tx
        .select({ id: schema.menus.id })
        .from(schema.menus)
        .where(and(eq(schema.menus.tenantId, ctxA.tenantId), eq(schema.menus.handle, "header")))
        .limit(1);

      if (existing) {
        await tx
          .update(schema.menus)
          .set({ title: "Main Menu", items: menuItems })
          .where(eq(schema.menus.id, existing.id));
      } else {
        await tx.insert(schema.menus).values({
          id: crypto.randomUUID(),
          tenantId: ctxA.tenantId,
          handle: "header",
          title: "Main Menu",
          kind: "navigation",
          items: menuItems,
        });
      }
    });

    // 5. Resolve render data for SiteHeader block
    const headerBlock: BlockInstance = {
      id: "hdr-1",
      type: "SiteHeader",
      version: 1,
      props: { menuHandle: "header" },
    };

    const renderData = await resolvePageRenderData(rt, ctxA, [headerBlock]);
    const menuBlockData = renderData.data["hdr-1"];

    expect(menuBlockData).toBeDefined();
    expect(menuBlockData?.kind).toBe("menu");
    if (menuBlockData?.kind === "menu") {
      const items = menuBlockData.items;
      // Home
      expect(items.find((i) => i.id === "m1")?.url).toBe("/");
      // Page by ID: canonical hierarchical path /pages/company/about-us
      expect(items.find((i) => i.id === "m2")?.url).toBe("/pages/company/about-us");
      // Collection by ID
      expect(items.find((i) => i.id === "m3")?.url).toBe("/collections/summer-wear");
      // Dead targets must be skipped
      expect(items.find((i) => i.id === "m4")).toBeUndefined();
      expect(items.find((i) => i.id === "m5")).toBeUndefined();
      // Safe external URL with newTab
      const ext = items.find((i) => i.id === "m6");
      expect(ext?.url).toBe("https://example.com");
      expect(ext?.newTab).toBe(true);
      // Unsafe URL skipped
      expect(items.find((i) => i.id === "m7")).toBeUndefined();
    }

    // 6. Test slug rename: rename child page from "about-us" to "our-story"
    const revalidated: string[][] = [];
    (rt as unknown as { revalidateTags: (tags: string[]) => Promise<void> }).revalidateTags = async (tags: string[]) => {
      revalidated.push(tags);
    };

    await updatePage(rt, ctxA, {
      id: child.id,
      title: "Our Story",
      slug: "our-story",
    });

    // Verify invalidation produced the tenant nav tag
    const allTags = revalidated.flat();
    expect(allTags).toContain(tenantTag(ctxA.tenantId, "nav"));

    const reloadedData = await resolvePageRenderData(rt, ctxA, [headerBlock]);
    if (reloadedData.data["hdr-1"]?.kind === "menu") {
      const item = reloadedData.data["hdr-1"].items.find((i) => i.id === "m2");
      // Link automatically updated to new canonical path because targetId points to page ID!
      expect(item?.url).toBe("/pages/company/our-story");
    }

    // 7. Reference guard: deletePage should be rejected because page child is referenced by menu
    await expect(deletePage(rt, ctxA, { id: child.id })).rejects.toThrow(
      /referenced by navigation menu "Main Menu"/,
    );
  });

  it("resolves footer menu columns and falls back to null for columns without menu", async () => {
    const colMenuId = crypto.randomUUID();
    await withTenant(rt._db.db, ctxA.tenantId, async (tx) => {
      await tx.insert(schema.menus).values({
        id: colMenuId,
        tenantId: ctxA.tenantId,
        handle: "footer-quick-links",
        title: "Footer Quick Links",
        kind: "navigation",
        items: [{ id: "f1", title: "Search", type: "search", url: "/search" }],
      });
    });

    const footerBlock: BlockInstance = {
      id: "ftr-1",
      type: "SiteFooter",
      version: 1,
      props: {
        columns: [
          { title: "Col 1", menuHandle: "footer-quick-links" },
          { title: "Col 2" }, // no menuHandle
        ],
      },
    };

    const renderData = await resolvePageRenderData(rt, ctxA, [footerBlock]);
    const footerData = renderData.data["ftr-1"];
    expect(footerData?.kind).toBe("footer-menus");
    if (footerData?.kind === "footer-menus") {
      expect(footerData.columns.length).toBe(2);
      expect(footerData.columns[0]?.[0]?.url).toBe("/search");
      expect(footerData.columns[1]).toBeNull();
    }
  });
});

describe("menu management and protection (Slice B)", () => {
  it("listMenus provides protected header and footer menus with itemCount and usedIn", async () => {
    const menus = await listMenus(rt, ctxA);
    const header = menus.find((m) => m.handle === "header");
    const footer = menus.find((m) => m.handle === "footer");

    expect(header).toBeDefined();
    expect(header?.isProtected).toBe(true);
    expect(header?.kind).toBe("navigation");
    expect(header?.usedIn).toContain("Header");

    expect(footer).toBeDefined();
    expect(footer?.isProtected).toBe(true);
    expect(footer?.kind).toBe("navigation");
    expect(footer?.usedIn).toContain("Footer");
  });

  it("prevents deleting protected default menus", async () => {
    const menus = await listMenus(rt, ctxA);
    const header = menus.find((m) => m.handle === "header")!;

    await expect(deleteMenu(rt, ctxA, { id: header.id })).rejects.toThrow(
      /Protected default menu "header" cannot be deleted/,
    );
  });

  it("prevents renaming handle of protected default menus", async () => {
    const menus = await listMenus(rt, ctxA);
    const header = menus.find((m) => m.handle === "header")!;

    await expect(updateMenu(rt, ctxA, { id: header.id, handle: "new-header-handle" })).rejects.toThrow(
      /Cannot change handle of protected menu "header"/,
    );
  });

  it("validates navigation menu items (safe schemes, depth <= 3)", async () => {
    // Unsafe scheme
    await expect(
      createMenu(rt, ctxA, {
        name: "Unsafe Menu",
        handle: "unsafe-menu",
        kind: "navigation",
        items: [{ id: "u1", title: "Javascript", url: "javascript:alert(1)", type: "url" }],
      }),
    ).rejects.toThrow(/Unsafe URL scheme/);

    // openInNewTab only allowed for https:
    await expect(
      createMenu(rt, ctxA, {
        name: "NewTab Insecure",
        handle: "newtab-insecure",
        kind: "navigation",
        items: [{ id: "u2", title: "Relative", url: "/pages/about", type: "url", openInNewTab: true }],
      }),
    ).rejects.toThrow(/Only https: links can be set to open in a new tab/);

    // Nesting depth > 3
    await expect(
      createMenu(rt, ctxA, {
        name: "Too Deep",
        handle: "too-deep",
        kind: "navigation",
        items: [
          {
            id: "d1",
            title: "L1",
            url: "/1",
            type: "url",
            children: [
              {
                id: "d2",
                title: "L2",
                url: "/2",
                type: "url",
                children: [
                  {
                    id: "d3",
                    title: "L3",
                    url: "/3",
                    type: "url",
                    children: [{ id: "d4", title: "L4", url: "/4", type: "url" }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/Navigation menus cannot exceed 3 levels of nesting/);
  });

  it("validates filter menu items and rejects non-filter shapes or nesting", async () => {
    // Rejects regular link in filter menu
    await expect(
      createMenu(rt, ctxA, {
        name: "Invalid Filter",
        handle: "invalid-filter",
        kind: "filter",
        items: [{ id: "f1", title: "Home", url: "/", type: "url" }],
      }),
    ).rejects.toThrow(/Invalid filter menu item/);

    // Rejects nested filter items
    await expect(
      createMenu(rt, ctxA, {
        name: "Nested Filter",
        handle: "nested-filter",
        kind: "filter",
        items: [
          {
            id: "f2",
            type: "filter",
            filter: { kind: "price", label: "Price", display: "range" },
            children: [{ id: "f3", type: "filter", filter: { kind: "brand", label: "Brand", display: "checkbox" } }],
          },
        ],
      }),
    ).rejects.toThrow(/Filter menus cannot have nested items/);

    // Valid filter menu creation
    const filterMenu = await createMenu(rt, ctxA, {
      name: "Shop Filters",
      handle: "shop-filters",
      kind: "filter",
      items: [
        {
          id: "flt-1",
          type: "filter",
          filter: { kind: "availability", label: "Availability", display: "checkbox" },
        },
        {
          id: "flt-2",
          type: "filter",
          filter: { kind: "price", label: "Price", display: "range" },
        },
        {
          id: "flt-3",
          type: "filter",
          filter: { kind: "option", label: "Color", display: "swatch", optionName: "Color" },
        },
      ],
    });

    expect(filterMenu.kind).toBe("filter");
    expect(filterMenu.itemCount).toBe(3);

    const fetched = await getMenu(rt, ctxA, { handle: "shop-filters" });
    expect(fetched.kind).toBe("filter");
    expect(fetched.items.length).toBe(3);

    // Cleanup custom menu
    await deleteMenu(rt, ctxA, { id: filterMenu.id });
  });
});

describe("filter menus faceted filtering and counts (Slice C)", () => {
  it("computes facet counts and applies bounded parameterized filters", async () => {
    // 1. Setup brands, location, collection, and products
    const [loc] = await withTenant(rt._db.db, ctxA.tenantId, async (tx) =>
      tx.select().from(schema.locations).where(eq(schema.locations.tenantId, ctxA.tenantId)).limit(1),
    );
    const locationId = loc!.id;

    const brandAId = crypto.randomUUID();
    const brandBId = crypto.randomUUID();
    const colId = crypto.randomUUID();
    const colSlug = "summer-collection";

    const p1Id = crypto.randomUUID();
    const p2Id = crypto.randomUUID();
    const p3Id = crypto.randomUUID();
    const pStraddleId = crypto.randomUUID();

    const v1Id = crypto.randomUUID();
    const v2Id = crypto.randomUUID();
    const v3Id = crypto.randomUUID();
    const vStraddleLowId = crypto.randomUUID();
    const vStraddleHighId = crypto.randomUUID();

    await withTenant(rt._db.db, ctxA.tenantId, async (tx) => {
      // Brands
      await tx.insert(schema.brands).values([
        { id: brandAId, tenantId: ctxA.tenantId, name: "Alpha", slug: "brand-alpha" },
        { id: brandBId, tenantId: ctxA.tenantId, name: "Beta", slug: "brand-beta" },
      ]);

      // Collection
      await tx.insert(schema.collections).values({
        id: colId,
        tenantId: ctxA.tenantId,
        title: "Summer Collection",
        slug: colSlug,
        type: "manual",
        published: true,
      });

      // Products
      await tx.insert(schema.products).values([
        {
          id: p1Id,
          tenantId: ctxA.tenantId,
          title: "Alpha T-Shirt",
          slug: "alpha-tshirt",
          status: "active",
          brandId: brandAId,
          tags: ["summer", "sale"],
        },
        {
          id: p2Id,
          tenantId: ctxA.tenantId,
          title: "Beta Hoodie",
          slug: "beta-hoodie",
          status: "active",
          brandId: brandBId,
          tags: ["winter"],
        },
        {
          id: p3Id,
          tenantId: ctxA.tenantId,
          title: "Alpha Jacket",
          slug: "alpha-jacket",
          status: "active",
          brandId: brandAId,
          tags: ["winter", "sale"],
        },
        {
          id: pStraddleId,
          tenantId: ctxA.tenantId,
          title: "Straddle Shoes",
          slug: "straddle-shoes",
          status: "active",
          brandId: brandBId,
          tags: ["casual"],
        },
      ]);

      // Variants
      await tx.insert(schema.variants).values([
        {
          id: v1Id,
          tenantId: ctxA.tenantId,
          productId: p1Id,
          title: "M",
          sku: "AL-TSH-M",
          price: 1000n,
          trackInventory: true,
          optionValues: { Size: "M" },
        },
        {
          id: v2Id,
          tenantId: ctxA.tenantId,
          productId: p2Id,
          title: "L",
          sku: "BT-HOD-L",
          price: 3000n,
          trackInventory: true,
          optionValues: { Size: "L" },
        },
        {
          id: v3Id,
          tenantId: ctxA.tenantId,
          productId: p3Id,
          title: "M",
          sku: "AL-JCK-M",
          price: 5000n,
          trackInventory: true,
          optionValues: { Size: "M" },
        },
        {
          id: vStraddleLowId,
          tenantId: ctxA.tenantId,
          productId: pStraddleId,
          title: "Low Variant",
          sku: "STR-LOW",
          price: 500n,
          trackInventory: true,
          optionValues: { Size: "S" },
        },
        {
          id: vStraddleHighId,
          tenantId: ctxA.tenantId,
          productId: pStraddleId,
          title: "High Variant",
          sku: "STR-HIGH",
          price: 9000n,
          trackInventory: true,
          optionValues: { Size: "XL" },
        },
      ]);

      // Inventory (p1 in stock, p2 in stock, p3 out of stock, straddle in stock)
      await tx.insert(schema.inventoryLevels).values([
        { tenantId: ctxA.tenantId, locationId, variantId: v1Id, onHand: 10, reserved: 0 },
        { tenantId: ctxA.tenantId, locationId, variantId: v2Id, onHand: 5, reserved: 0 },
        { tenantId: ctxA.tenantId, locationId, variantId: v3Id, onHand: 0, reserved: 0 },
        { tenantId: ctxA.tenantId, locationId, variantId: vStraddleLowId, onHand: 5, reserved: 0 },
        { tenantId: ctxA.tenantId, locationId, variantId: vStraddleHighId, onHand: 5, reserved: 0 },
      ]);

      // Map to Collection
      await tx.insert(schema.collectionProducts).values([
        { tenantId: ctxA.tenantId, collectionId: colId, productId: p1Id, position: 1 },
        { tenantId: ctxA.tenantId, collectionId: colId, productId: p2Id, position: 2 },
        { tenantId: ctxA.tenantId, collectionId: colId, productId: p3Id, position: 3 },
        { tenantId: ctxA.tenantId, collectionId: colId, productId: pStraddleId, position: 4 },
      ]);
    });

    // 2. Create Filter Menu
    const filterMenu = await createMenu(rt, ctxA, {
      name: "Catalog Filters",
      handle: "catalog-filters",
      kind: "filter",
      items: [
        {
          id: "f-avail",
          type: "filter",
          filter: { kind: "availability", label: "In Stock", display: "checkbox" },
        },
        {
          id: "f-price",
          type: "filter",
          filter: { kind: "price", label: "Price", display: "range" },
        },
        {
          id: "f-brand",
          type: "filter",
          filter: { kind: "brand", label: "Brand", display: "checkbox" },
        },
        {
          id: "f-size",
          type: "filter",
          filter: { kind: "option", label: "Size", display: "swatch", optionName: "Size" },
        },
        {
          id: "f-tag",
          type: "filter",
          filter: { kind: "tag", label: "Tags", display: "checkbox" },
        },
      ],
    });

    // 3. Test collection query with filter menu: facet counts
    const fullRes = await getStorefrontCollection(rt, ctxA, colSlug, {
      filterMenuHandle: "catalog-filters",
    });

    expect(fullRes).not.toBeNull();
    expect(fullRes!.products.total).toBe(4);
    expect(fullRes!.filterData).toBeDefined();

    const facets = fullRes!.filterData!.facets;
    expect(facets.length).toBe(5);

    // Availability facet: 3 in stock (p1, p2, straddle)
    const availFacet = facets.find((f) => f.kind === "availability");
    expect(availFacet?.values?.[0]?.count).toBe(3);

    // Price facet: min 500, max 9000 (straddle variants extend the range)
    const priceFacet = facets.find((f) => f.kind === "price");
    expect(priceFacet?.range?.min).toBe(500);
    expect(priceFacet?.range?.max).toBe(9000);

    // Brand facet: Alpha has 2, Beta has 2
    const brandFacet = facets.find((f) => f.kind === "brand");
    const alphaBrand = brandFacet?.values?.find((v) => v.value === "brand-alpha");
    const betaBrand = brandFacet?.values?.find((v) => v.value === "brand-beta");
    expect(alphaBrand?.count).toBe(2);
    expect(betaBrand?.count).toBe(2);

    // Size option facet: M has 2, L has 1
    const sizeFacet = facets.find((f) => f.kind === "option" && f.optionName === "Size");
    const sizeM = sizeFacet?.values?.find((v) => v.value === "M");
    const sizeL = sizeFacet?.values?.find((v) => v.value === "L");
    expect(sizeM?.count).toBe(2);
    expect(sizeL?.count).toBe(1);

    // Tag facet: sale has 2, winter has 2, summer has 1
    const tagFacet = facets.find((f) => f.kind === "tag");
    const tagSale = tagFacet?.values?.find((v) => v.value === "sale");
    expect(tagSale?.count).toBe(2);

    // 4. Test Filtering by Brand
    const brandFiltered = await getStorefrontCollection(rt, ctxA, colSlug, {
      filterMenuHandle: "catalog-filters",
      filters: { brand: "brand-alpha" },
    });
    expect(brandFiltered!.products.total).toBe(2);
    expect(brandFiltered!.products.items.map((p) => p.id)).toEqual(expect.arrayContaining([p1Id, p3Id]));
    expect(brandFiltered!.filterData?.activeFilterCount).toBe(1);

    // 5. Test Filtering by Price Range (2000 - 4000)
    // CRITICAL: pStraddle has variants at 500 and 9000 which straddle this range.
    // With a single combined EXISTS clause requiring both bounds on the same variant,
    // pStraddle MUST NOT match.
    const priceFiltered = await getStorefrontCollection(rt, ctxA, colSlug, {
      filterMenuHandle: "catalog-filters",
      filters: { price: "2000-4000" },
    });
    expect(priceFiltered!.products.total).toBe(1);
    expect(priceFiltered!.products.items[0]?.id).toBe(p2Id);
    expect(priceFiltered!.products.items.map((p) => p.id)).not.toContain(pStraddleId);

    // 6. Test Filtering by Availability (In Stock only)
    const stockFiltered = await getStorefrontCollection(rt, ctxA, colSlug, {
      filterMenuHandle: "catalog-filters",
      filters: { in_stock: "1" },
    });
    expect(stockFiltered!.products.total).toBe(3);
    expect(stockFiltered!.products.items.map((p) => p.id)).toEqual(expect.arrayContaining([p1Id, p2Id, pStraddleId]));

    // 7. Test Filtering by Option (Size: L)
    const optionFiltered = await getStorefrontCollection(rt, ctxA, colSlug, {
      filterMenuHandle: "catalog-filters",
      filters: { size: "L" },
    });
    expect(optionFiltered!.products.total).toBe(1);
    expect(optionFiltered!.products.items[0]?.id).toBe(p2Id);

    // 8. Test Filtering by Tag (summer)
    const tagFiltered = await getStorefrontCollection(rt, ctxA, colSlug, {
      filterMenuHandle: "catalog-filters",
      filters: { tag: "summer" },
    });
    expect(tagFiltered!.products.total).toBe(1);
    expect(tagFiltered!.products.items[0]?.id).toBe(p1Id);

    // 9. Bounded inputs: ignore options not in filter menu
    const invalidOptFiltered = await getStorefrontCollection(rt, ctxA, colSlug, {
      filterMenuHandle: "catalog-filters",
      filters: { unknown_option: "XYZ" },
    });
    expect(invalidOptFiltered!.products.total).toBe(4);

    // 10. Capture EXPLAIN query plan evidence on real Postgres
    await withTenant(rt._db.db, ctxA.tenantId, async (tx) => {
      const explainResult = await tx.execute(
        sql`EXPLAIN ANALYZE
            SELECT p.id, p.title
            FROM collection_products cp
            JOIN products p ON p.tenant_id = cp.tenant_id AND p.id = cp.product_id
            WHERE cp.collection_id = ${colId}
              AND p.tenant_id = ${ctxA.tenantId}
              AND p.status = 'active'
              AND p.deleted_at IS NULL
              AND EXISTS (
                SELECT 1 FROM variants v
                JOIN inventory_levels il ON il.tenant_id = v.tenant_id AND il.variant_id = v.id
                WHERE v.tenant_id = p.tenant_id AND v.product_id = p.id AND (il.on_hand - il.reserved) > 0
              )
              AND EXISTS (
                SELECT 1 FROM brands b
                WHERE b.tenant_id = p.tenant_id AND b.id = p.brand_id AND b.slug = 'brand-alpha'
              )`,
      );
      expect(explainResult.rows.length).toBeGreaterThan(0);
      console.log("EXPLAIN ANALYZE OUTPUT FOR FACETED QUERY:\n", explainResult.rows.map((r: Record<string, unknown>) => r["QUERY PLAN"]).join("\n"));
    });

    // Cleanup
    await deleteMenu(rt, ctxA, { id: filterMenu.id });
  });
});
