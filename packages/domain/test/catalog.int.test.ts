import { beforeAll, describe, expect, it } from "vitest";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  adjustInventory,
  createBrand,
  createCategory,
  createCollection,
  createLocation,
  createProduct,
  createRuntime,
  deleteBrand,
  deleteCategory,
  deleteCollection,
  deleteLocation,
  deleteProduct,
  getBrand,
  getCategory,
  getCollection,
  getLocation,
  getProduct,
  listBrands,
  listCategories,
  listCollections,
  listLocations,
  listProducts,
  provisionTenant,
  updateBrand,
  updateCategory,
  updateCollection,
  updateLocation,
  updateProduct,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

/**
 * Real-database integration tests for catalog services:
 * - Category tree 3-level depth limit & delete guards
 * - Collection rules and manual ordering
 * - Brand deletion and product unlinking
 * - Location default/active/stock constraints
 * - Primary category enforcement & partial unique index
 * - Write-only actor read-backs (products.write without products.read)
 * - RLS isolation across tenants
 */

let env: TestDb;
let rt: Runtime;
let rtPlatform: Runtime;
let ctxA: TenantContext;
let ctxB: TenantContext;
let ctxWriteOnly: TenantContext;

async function tenant(label: string) {
  const run = Math.random().toString(36).slice(2, 7);
  const t = await provisionTenant(rtPlatform, {
    storeName: `Catalog ${label} ${run}`,
    slug: `catalog-${label}-${run}`,
    owner: { email: `owner-${label}-${run}@catalog.test`, name: "Owner" },
    planCode: "starter",
    source: "platform_admin",
  });
  const ctx: TenantContext = {
    tenantId: t.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: t.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: `req-catalog-${label}`,
  };
  return ctx;
}

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 10 });
  rt = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 10 });
  ctxA = await tenant("a");
  ctxB = await tenant("b");

  ctxWriteOnly = {
    tenantId: ctxA.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: ctxA.actor.type === "staff" ? ctxA.actor.userId : "staff-write" },
    roles: ["catalog_writer"],
    permissions: ["products.write"], // write only, NO products.read
    requestId: "req-catalog-write-only",
  };
}, 180_000);

describe("Catalog Services (Real Postgres)", () => {
  describe("Write-only actor read-back", () => {
    it("allows write-only actor (products.write without products.read) to create and update entities", async () => {
      // 1. Category
      const cat = await createCategory(rt, ctxWriteOnly, { name: "Write Only Cat" });
      expect(cat.name).toBe("Write Only Cat");

      const updatedCat = await updateCategory(rt, ctxWriteOnly, { id: cat.id, name: "Write Only Cat Renamed" });
      expect(updatedCat.name).toBe("Write Only Cat Renamed");

      // 2. Product
      const prod = await createProduct(rt, ctxWriteOnly, {
        title: "Write Only Product",
        status: "active",
        primaryCategoryId: cat.id,
        variants: [{ sku: "WO-1", title: "Default", price: 5000 }],
      });
      expect(prod.title).toBe("Write Only Product");

      const updatedProd = await updateProduct(rt, ctxWriteOnly, {
        id: prod.id,
        title: "Write Only Product Updated",
      });
      expect(updatedProd.title).toBe("Write Only Product Updated");

      // 3. Collection
      const col = await createCollection(rt, ctxWriteOnly, {
        title: "Write Only Col",
        type: "manual",
        productIds: [prod.id],
      });
      expect(col.title).toBe("Write Only Col");

      const updatedCol = await updateCollection(rt, ctxWriteOnly, {
        id: col.id,
        title: "Write Only Col Updated",
      });
      expect(updatedCol.title).toBe("Write Only Col Updated");

      // 4. Brand
      const brand = await createBrand(rt, ctxWriteOnly, { name: "Write Only Brand" });
      expect(brand.name).toBe("Write Only Brand");

      const updatedBrand = await updateBrand(rt, ctxWriteOnly, {
        id: brand.id,
        name: "Write Only Brand Updated",
      });
      expect(updatedBrand.name).toBe("Write Only Brand Updated");

      // 5. Location
      const loc = await createLocation(rt, ctxWriteOnly, { name: "Write Only Loc" });
      expect(loc.name).toBe("Write Only Loc");

      const updatedLoc = await updateLocation(rt, ctxWriteOnly, {
        id: loc.id,
        name: "Write Only Loc Updated",
      });
      expect(updatedLoc.name).toBe("Write Only Loc Updated");

      // Direct read with write-only actor MUST be rejected
      await expect(getProduct(rt, ctxWriteOnly, { id: prod.id })).rejects.toThrow(/permission/i);
      await expect(getCategory(rt, ctxWriteOnly, { id: cat.id })).rejects.toThrow(/permission/i);
      await expect(getCollection(rt, ctxWriteOnly, { id: col.id })).rejects.toThrow(/permission/i);
      await expect(getBrand(rt, ctxWriteOnly, { id: brand.id })).rejects.toThrow(/permission/i);
      await expect(getLocation(rt, ctxWriteOnly, { id: loc.id })).rejects.toThrow(/permission/i);
    });
  });

  describe("Category depth and delete guards", () => {
    it("enforces max 3 levels depth and rejects level 4", async () => {
      const l1 = await createCategory(rt, ctxA, { name: "Level 1" });
      expect(l1.path).toBe("/");

      const l2 = await createCategory(rt, ctxA, { name: "Level 2", parentId: l1.id });
      expect(l2.path).toBe(`/${l1.id}/`);

      const l3 = await createCategory(rt, ctxA, { name: "Level 3", parentId: l2.id });
      expect(l3.path).toBe(`/${l1.id}/${l2.id}/`);

      // Level 4 should throw
      await expect(createCategory(rt, ctxA, { name: "Level 4", parentId: l3.id })).rejects.toThrow(
        /maximum depth is 3 levels/i,
      );
    });

    it("prevents deleting a category with subcategories", async () => {
      const parent = await createCategory(rt, ctxA, { name: "Parent Guard" });
      await createCategory(rt, ctxA, { name: "Child Guard", parentId: parent.id });

      await expect(deleteCategory(rt, ctxA, { id: parent.id })).rejects.toThrow(
        /Cannot delete category with subcategories/i,
      );
    });

    it("prevents deleting a category assigned to products", async () => {
      const cat = await createCategory(rt, ctxA, { name: "Product Guard Cat" });
      await createProduct(rt, ctxA, {
        title: "Guarded Product",
        status: "draft",
        primaryCategoryId: cat.id,
      });

      await expect(deleteCategory(rt, ctxA, { id: cat.id })).rejects.toThrow(
        /Cannot delete category because products are assigned to it/i,
      );
    });

    it("allows deleting an empty leaf category", async () => {
      const cat = await createCategory(rt, ctxA, { name: "Leaf Cat" });
      const res = await deleteCategory(rt, ctxA, { id: cat.id });
      expect(res.success).toBe(true);

      await expect(getCategory(rt, ctxA, { id: cat.id })).rejects.toThrow(/not found/i);
    });
  });

  describe("Collections manual ordering and rules", () => {
    it("maintains manual product ordering and updates properly", async () => {
      const cat = await createCategory(rt, ctxA, { name: "Col Order Cat" });
      const p1 = await createProduct(rt, ctxA, { title: "P1", status: "active", primaryCategoryId: cat.id });
      const p2 = await createProduct(rt, ctxA, { title: "P2", status: "active", primaryCategoryId: cat.id });
      const p3 = await createProduct(rt, ctxA, { title: "P3", status: "active", primaryCategoryId: cat.id });

      const col = await createCollection(rt, ctxA, {
        title: "Featured Manual",
        type: "manual",
        productIds: [p1.id, p2.id, p3.id],
      });

      expect(col.productIds).toEqual([p1.id, p2.id, p3.id]);

      // Reorder to [p3, p1, p2]
      const updated = await updateCollection(rt, ctxA, {
        id: col.id,
        productIds: [p3.id, p1.id, p2.id],
      });

      expect(updated.productIds).toEqual([p3.id, p1.id, p2.id]);
    });
  });

  describe("Brand deletion", () => {
    it("deletes brand and unlinks it from products with affected count", async () => {
      const brand = await createBrand(rt, ctxA, { name: "Acme Corp" });
      const cat = await createCategory(rt, ctxA, { name: "Brand Cat" });

      const p1 = await createProduct(rt, ctxA, {
        title: "Brand Product 1",
        status: "draft",
        primaryCategoryId: cat.id,
        brandId: brand.id,
      });
      const p2 = await createProduct(rt, ctxA, {
        title: "Brand Product 2",
        status: "draft",
        primaryCategoryId: cat.id,
        brandId: brand.id,
      });

      const delResult = await deleteBrand(rt, ctxA, { id: brand.id });
      expect(delResult.success).toBe(true);
      expect(delResult.affectedProducts).toBe(2);

      // Verify product brandId is set to null
      const updatedP1 = await getProduct(rt, ctxA, { id: p1.id });
      expect(updatedP1.brandId).toBeNull();
      const updatedP2 = await getProduct(rt, ctxA, { id: p2.id });
      expect(updatedP2.brandId).toBeNull();
    });
  });

  describe("Location constraints", () => {
    it("enforces default location uniqueness, deactivation guards, and stock guards", async () => {
      // 1. Initial default location created during provisioning
      const initialLocations = await listLocations(rt, ctxA);
      const defaultLoc = initialLocations.find((l) => l.isDefault);
      expect(defaultLoc).toBeDefined();

      // 2. Default location cannot be deactivated
      await expect(
        updateLocation(rt, ctxA, { id: defaultLoc!.id, isActive: false }),
      ).rejects.toThrow(/The default location cannot be deactivated/i);

      // 3. Default location cannot be deleted
      await expect(
        deleteLocation(rt, ctxA, { id: defaultLoc!.id }),
      ).rejects.toThrow(/The default location cannot be deleted/i);

      // 4. Create second location and set it as default -> clears old default
      const loc2 = await createLocation(rt, ctxA, {
        name: "Warehouse North",
        isDefault: true,
        isActive: true,
      });
      expect(loc2.isDefault).toBe(true);

      const oldDefault = await getLocation(rt, ctxA, { id: defaultLoc!.id });
      expect(oldDefault.isDefault).toBe(false);

      // 5. Cannot deactivate the only active location if all others are inactive
      // Make loc2 inactive? loc2 is now default, so let's switch default back to defaultLoc
      await updateLocation(rt, ctxA, { id: defaultLoc!.id, isDefault: true });
      await updateLocation(rt, ctxA, { id: loc2.id, isActive: false });

      // Now defaultLoc is the only active location. Deactivating it should throw
      await expect(
        updateLocation(rt, ctxA, { id: defaultLoc!.id, isActive: false }),
      ).rejects.toThrow(/The default location cannot be deactivated/i);

      // Reactivate loc2
      await updateLocation(rt, ctxA, { id: loc2.id, isActive: true });

      // 6. Location with stock cannot be deleted
      const cat = await createCategory(rt, ctxA, { name: "Stock Loc Cat" });
      const prod = await createProduct(rt, ctxA, {
        title: "Stocked Item",
        status: "active",
        primaryCategoryId: cat.id,
        variants: [{ sku: "STK-LOC-1", title: "Default", price: 1000 }],
      });
      const vId = prod.variants[0]!.id;

      await adjustInventory(rt, ctxA, {
        variantId: vId,
        locationId: loc2.id,
        quantityDelta: 15,
        reason: "received",
      });

      await expect(
        deleteLocation(rt, ctxA, { id: loc2.id }),
      ).rejects.toThrow(/Cannot delete a location with stock on hand/i);

      // Reduce stock back to 0
      await adjustInventory(rt, ctxA, {
        variantId: vId,
        locationId: loc2.id,
        quantityDelta: -15,
        reason: "correction",
      });

      // Now loc2 can be deleted (since defaultLoc is active and default)
      const delLocRes = await deleteLocation(rt, ctxA, { id: loc2.id });
      expect(delLocRes.success).toBe(true);
    });
  });

  describe("Product primary category constraints & partial unique index", () => {
    it("enforces partial unique index for exactly one primary category per product", async () => {
      const cat1 = await createCategory(rt, ctxA, { name: "Cat 1" });
      const cat2 = await createCategory(rt, ctxA, { name: "Cat 2" });

      const prod = await createProduct(rt, ctxA, {
        title: "Primary Category Test",
        status: "active",
        primaryCategoryId: cat1.id,
        extraCategoryIds: [cat2.id],
      });

      expect(prod.primaryCategoryId).toBe(cat1.id);
      expect(prod.extraCategoryIds).toEqual([cat2.id]);

      // Directly attempt to insert a second is_primary=true row for the same product in db
      await expect(
        withTenant(rt._db.db, ctxA.tenantId, (tx) =>
          tx.insert(schema.productCategories).values({
            tenantId: ctxA.tenantId,
            productId: prod.id,
            categoryId: cat2.id,
            isPrimary: true,
            position: 99,
          }),
        ),
      ).rejects.toThrow(); // Violates product_categories_product_primary_uidx
    });
  });

  describe("Tenant Isolation (RLS)", () => {
    it("ensures Store B cannot read or modify Store A's catalog data", async () => {
      // Create resources in Store A
      const catA = await createCategory(rt, ctxA, { name: "Store A Only Cat" });
      const colA = await createCollection(rt, ctxA, { title: "Store A Only Col" });
      const brandA = await createBrand(rt, ctxA, { name: "Store A Only Brand" });
      const locA = await createLocation(rt, ctxA, { name: "Store A Only Loc" });
      const prodA = await createProduct(rt, ctxA, {
        title: "Store A Only Prod",
        status: "active",
        primaryCategoryId: catA.id,
      });

      // 1. Store B cannot read Store A's entities by ID
      await expect(getCategory(rt, ctxB, { id: catA.id })).rejects.toThrow(/not found/i);
      await expect(getCollection(rt, ctxB, { id: colA.id })).rejects.toThrow(/not found/i);
      await expect(getBrand(rt, ctxB, { id: brandA.id })).rejects.toThrow(/not found/i);
      await expect(getLocation(rt, ctxB, { id: locA.id })).rejects.toThrow(/not found/i);
      await expect(getProduct(rt, ctxB, { id: prodA.id })).rejects.toThrow(/not found/i);

      // 2. Store B cannot update Store A's entities
      await expect(updateCategory(rt, ctxB, { id: catA.id, name: "Hacked" })).rejects.toThrow(/not found/i);
      await expect(updateCollection(rt, ctxB, { id: colA.id, title: "Hacked" })).rejects.toThrow(/not found/i);
      await expect(updateBrand(rt, ctxB, { id: brandA.id, name: "Hacked" })).rejects.toThrow(/not found/i);
      await expect(updateLocation(rt, ctxB, { id: locA.id, name: "Hacked" })).rejects.toThrow(/not found/i);
      await expect(updateProduct(rt, ctxB, { id: prodA.id, title: "Hacked" })).rejects.toThrow(/not found/i);

      // 3. Store B cannot delete Store A's entities
      await expect(deleteCategory(rt, ctxB, { id: catA.id })).rejects.toThrow(/not found/i);
      await expect(deleteCollection(rt, ctxB, { id: colA.id })).rejects.toThrow(/not found/i);
      await expect(deleteBrand(rt, ctxB, { id: brandA.id })).rejects.toThrow(/not found/i);
      await expect(deleteLocation(rt, ctxB, { id: locA.id })).rejects.toThrow(/not found/i);
      await expect(deleteProduct(rt, ctxB, { id: prodA.id })).rejects.toThrow();

      // 4. Store B listings do not contain Store A items
      const catsB = await listCategories(rt, ctxB);
      expect(catsB.some((c) => c.id === catA.id)).toBe(false);

      const colsB = await listCollections(rt, ctxB);
      expect(colsB.some((c) => c.id === colA.id)).toBe(false);

      const brandsB = await listBrands(rt, ctxB);
      expect(brandsB.some((b) => b.id === brandA.id)).toBe(false);

      const locsB = await listLocations(rt, ctxB);
      expect(locsB.some((l) => l.id === locA.id)).toBe(false);

      const prodsB = await listProducts(rt, ctxB);
      expect(prodsB.items.some((p) => p.id === prodA.id)).toBe(false);
    });
  });
});
