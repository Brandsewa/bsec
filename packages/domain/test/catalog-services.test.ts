import { describe, expect, it } from "vitest";
import type { Db } from "@bs/db";
import type { Runtime, TenantContext } from "../src/index.ts";
import {
  listProducts,
  createProduct,
  adjustInventory,
  getBrandSettings,
  updateBrandSettings,
  publishBrandSettings,
  savePageDraft,
  publishPage,
  listCategories,
  createCategory,
  deleteCategory,
  listCollections,
  createCollection,
  updateCollection,
  listBrands,
  createBrand,
  deleteBrand,
  listLocations,
  createLocation,
  updateLocation,
  deleteLocation,
} from "../src/index.ts";

describe("M2 Domain Services", () => {
  const tenantId = "0199a000-0000-7000-8000-000000000001";

  const adminCtx: TenantContext = {
    tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: "user-1" },
    roles: ["store_admin"],
    permissions: [
      "products.read",
      "products.write",
      "settings.write",
      "theme.publish",
      "content.write",
    ],
    requestId: "req-1",
  };

  const restrictedCtx: TenantContext = {
    tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: "user-2" },
    roles: ["store_staff"],
    permissions: [],
    requestId: "req-2",
  };

  const createMockRuntime = (mockDb: Db): Runtime => ({
    service: "web",
    _db: { db: mockDb, pool: {} as never, close: async () => {} },
    close: async () => {},
  });

  describe("Product Services", () => {
    it("throws Forbidden if products.read is missing", async () => {
      const rt = createMockRuntime({} as Db);
      await expect(listProducts(rt, restrictedCtx)).rejects.toThrow(/Forbidden/);
    });

    it("throws Forbidden if products.write is missing", async () => {
      const rt = createMockRuntime({} as Db);
      await expect(createProduct(rt, restrictedCtx, { title: "Test" })).rejects.toThrow(/Forbidden/);
    });
  });

  describe("Inventory Services", () => {
    it("adjusts inventory and records an inventory movement ledger entry", async () => {
      let movementRecorded = false;
      let levelUpdated = false;

      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {},
            select: () => ({
              from: () => ({
                where: () => [
                  {
                    id: "lvl-1",
                    tenantId,
                    variantId: "var-1",
                    locationId: "loc-1",
                    onHand: 10,
                    reserved: 0,
                  },
                ],
              }),
            }),
            update: () => ({
              set: () => ({
                where: () => {
                  levelUpdated = true;
                  return [{ id: "lvl-1" }];
                },
              }),
            }),
            insert: () => ({
              values: () => {
                movementRecorded = true;
                return [{ id: "mov-1" }];
              },
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const res = await adjustInventory(rt, adminCtx, {
        variantId: "0199a000-0000-7000-8000-000000000010",
        locationId: "0199a000-0000-7000-8000-000000000020",
        quantityDelta: 5,
        reason: "received",
        notes: "Stock delivery PO-102",
      });

      expect(res.success).toBe(true);
      expect(res.newOnHand).toBe(15);
      expect(levelUpdated).toBe(true);
      expect(movementRecorded).toBe(true);
    });
  });

  describe("Branding Services", () => {
    it("gets brand settings or returns default if not set", async () => {
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {},
            select: () => ({
              from: () => ({
                where: () => [],
              }),
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const branding = await getBrandSettings(rt, adminCtx);

      expect(branding.primaryColor).toBeDefined();
      expect(branding.fontHeading).toBeDefined();
      expect(branding.version).toBe(1);
    });

    it("updates brand settings and stores color tokens", async () => {
      let updatedColors: unknown = null;
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {},
            select: () => ({
              from: () => ({
                where: () => [{ id: "b-1", colors: { primary: "#000000" } }],
              }),
            }),
            update: () => ({
              set: (vals: { colors?: unknown }) => ({
                where: () => {
                  updatedColors = vals.colors;
                  return [{ id: "b-1" }];
                },
              }),
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const res = await updateBrandSettings(rt, adminCtx, {
        primaryColor: "#2563eb",
      });

      expect(res).toBeDefined();
      expect(updatedColors).toBeDefined();
    });

    it("publishes brand settings bumping the version number", async () => {
      let updatedVersion: number | null = null;
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {},
            select: () => ({
              from: () => ({
                where: () => [{ id: "b-1", version: 1 }],
              }),
            }),
            update: () => ({
              set: (vals: { version: number }) => ({
                where: () => {
                  updatedVersion = vals.version;
                  return [{ id: "b-1" }];
                },
              }),
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const res = await publishBrandSettings(rt, adminCtx);

      expect(res.version).toBe(2);
      expect(updatedVersion).toBe(2);
    });
  });

  describe("Content & Page Services", () => {
    it("validates blocks when saving page drafts", async () => {
      const pageId = "0199a000-0000-7000-8000-000000000099";
      let versionCreated = false;

      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {},
            select: () => ({
              from: () => ({
                where: () => ({
                  orderBy: () => ({
                    limit: () => [{ id: pageId, versionNumber: 1 }],
                  }),
                }),
              }),
            }),
            insert: () => ({
              values: () => ({
                returning: () => {
                  versionCreated = true;
                  return [{ id: "ver-1" }];
                },
              }),
            }),
            update: () => ({
              set: () => ({
                where: () => [{ id: pageId }],
              }),
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const res = await savePageDraft(rt, adminCtx, {
        id: pageId,
        blocks: [
          {
            id: "b1",
            type: "Hero",
            version: 1,
            props: { title: "Welcome Home" },
          },
        ],
      });

      expect(res.versionId).toBe("ver-1");
      expect(versionCreated).toBe(true);
    });

    it("rejects invalid block documents when saving drafts", async () => {
      const pageId = "0199a000-0000-7000-8000-000000000099";
      const rt = createMockRuntime({} as Db);

      await expect(
        savePageDraft(rt, adminCtx, {
          id: pageId,
          blocks: [
            {
              id: "b1",
              type: "Hero",
              version: 1,
              props: {
                // missing title
              },
            },
          ],
        }),
      ).rejects.toThrow(/Validation failed/);
    });

    it("publishes page pointing publishedVersionId", async () => {
      const pageId = "0199a000-0000-7000-8000-000000000099";
      let publishedId: string | null = null;

      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {},
            select: () => ({
              from: () => ({
                where: () => ({
                  orderBy: () => ({
                    limit: () => [{ id: "ver-latest" }],
                  }),
                }),
              }),
            }),
            update: () => ({
              set: (vals: { publishedVersionId: string }) => ({
                where: () => {
                  publishedId = vals.publishedVersionId;
                  return [{ id: pageId }];
                },
              }),
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const res = await publishPage(rt, adminCtx, { id: pageId });
      expect(res.success).toBe(true);
      expect(publishedId).toBe("ver-latest");
    });
  });

  describe("Category Services", () => {
    it("throws Forbidden if products.read is missing for listCategories", async () => {
      const rt = createMockRuntime({} as Db);
      await expect(listCategories(rt, restrictedCtx)).rejects.toThrow(/Forbidden/);
    });

    it("throws Forbidden if products.write is missing for createCategory", async () => {
      const rt = createMockRuntime({} as Db);
      await expect(createCategory(rt, restrictedCtx, { name: "Keyboards" })).rejects.toThrow(/Forbidden/);
    });

    it("refuses subcategories beyond 3 levels deep", async () => {
      // Level 1: "/", Level 2: "/id1/", Level 3: "/id1/id2/"
      // Parent at level 3 (path "/id1/id2/") should reject child
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {},
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: () => [{ id: "cat-3", path: "/id1/id2/", parentId: "id2" }],
                }),
              }),
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      await expect(
        createCategory(rt, adminCtx, {
          name: "Level 4 Subcategory",
          parentId: "cat-3",
        }),
      ).rejects.toThrow(/maximum depth is 3 levels/);
    });

    it("refuses deleting category with subcategories", async () => {
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {},
            select: () => ({
              from: () => ({
                where: () => [{ count: 2 }],
              }),
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      await expect(deleteCategory(rt, adminCtx, { id: "cat-with-children" })).rejects.toThrow(
        /Cannot delete category with subcategories/,
      );
    });

    it("refuses deleting category with assigned products", async () => {
      let queryCount = 0;
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {},
            select: () => ({
              from: () => ({
                where: () => {
                  queryCount++;
                  if (queryCount === 1) {
                    // child categories count = 0
                    return [{ count: 0 }];
                  }
                  // assigned products count = 5
                  return [{ count: 5 }];
                },
              }),
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      await expect(deleteCategory(rt, adminCtx, { id: "cat-with-products" })).rejects.toThrow(
        /products are assigned to it/,
      );
    });
  });

  describe("Collection Services", () => {
    it("throws Forbidden if products.read is missing for listCollections", async () => {
      const rt = createMockRuntime({} as Db);
      await expect(listCollections(rt, restrictedCtx)).rejects.toThrow(/Forbidden/);
    });

    it("throws Forbidden if products.write is missing for createCollection", async () => {
      const rt = createMockRuntime({} as Db);
      await expect(createCollection(rt, restrictedCtx, { title: "Featured Keyboards" })).rejects.toThrow(/Forbidden/);
    });

    it("creates collection with indexable defaulted to false", async () => {
      let insertedValues: Record<string, unknown> | null = null;
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {},
            insert: () => ({
              values: (vals: Record<string, unknown>) => {
                if ("title" in vals) {
                  insertedValues = vals;
                }
                return {
                  returning: () => [
                    {
                      id: "col-1",
                      title: vals["title"],
                      slug: "featured",
                      type: vals["type"] ?? "manual",
                      match: vals["match"] ?? "all",
                      sortOrder: "manual",
                      published: vals["published"] ?? true,
                      indexable: vals["indexable"] ?? false,
                      createdAt: new Date(),
                      updatedAt: new Date(),
                    },
                  ],
                };
              },
            }),
            select: () => ({
              from: () => ({
                leftJoin: () => ({
                  where: () => ({
                    limit: () => [
                      {
                        id: "col-1",
                        title: "Featured",
                        slug: "featured",
                        type: "manual",
                        match: "all",
                        sortOrder: "manual",
                        published: true,
                        indexable: false,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                      },
                    ],
                  }),
                }),
                innerJoin: () => ({
                  where: () => ({
                    orderBy: () => [],
                  }),
                }),
              }),
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const res = await createCollection(rt, adminCtx, { title: "Featured" });
      expect(insertedValues).toBeDefined();
      expect(insertedValues!["indexable"]).toBe(false);
      expect(res.indexable).toBe(false);
    });
  });

  describe("Brand Services", () => {
    it("throws Forbidden if products.read is missing on listBrands", async () => {
      const rt = createMockRuntime({} as Db);
      await expect(listBrands(rt, restrictedCtx)).rejects.toThrow(/Forbidden/);
    });

    it("throws Forbidden if products.write is missing on createBrand", async () => {
      const rt = createMockRuntime({} as Db);
      await expect(createBrand(rt, restrictedCtx, { name: "Nike", slug: "nike" })).rejects.toThrow(/Forbidden/);
    });
  });

  describe("Location Services", () => {
    it("throws Forbidden if products.read is missing on listLocations", async () => {
      const rt = createMockRuntime({} as Db);
      await expect(listLocations(rt, restrictedCtx)).rejects.toThrow(/Forbidden/);
    });

    it("throws Forbidden if products.write is missing on createLocation", async () => {
      const rt = createMockRuntime({} as Db);
      await expect(
        createLocation(rt, restrictedCtx, {
          name: "Main",
          address: { line1: "123 St", city: "Mumbai", stateCode: "MH", countryCode: "IN" },
          pincode: "400001",
        })
      ).rejects.toThrow(/Forbidden/);
    });

    it("prevents deleting default location", async () => {
      const mockDb = {
        transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
          return fn({
            execute: async () => {},
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: () => [
                    {
                      id: "loc-default",
                      name: "Main Hub",
                      isDefault: true,
                      isActive: true,
                    },
                  ],
                }),
              }),
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      await expect(deleteLocation(rt, adminCtx, { id: "loc-default" })).rejects.toThrow(/default location cannot be deleted/);
    });
  });
});
