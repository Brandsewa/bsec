import { describe, expect, it } from "vitest";
import type { Db } from "@bs/db";
import type { Runtime, TenantContext } from "../src/index.ts";
import {
  getStorefrontProduct,
  getStorefrontCollection,
  getStorefrontCategory,
  searchStorefrontProducts,
  getSearchSuggestions,
} from "../src/index.ts";

describe("Storefront Catalog & Search Services", () => {
  const tenantId = "0199a000-0000-7000-8000-000000000001";

  const publicCtx: TenantContext = {
    tenantId,
    storeStatus: "live",
    actor: { type: "anonymous" },
    roles: [],
    permissions: [],
    requestId: "req-storefront-1",
  };

  const createMockRuntime = (mockDb: Db): Runtime => {
    const origTx = (mockDb as unknown as { transaction?: (cb: (tx: unknown) => Promise<unknown>) => Promise<unknown> }).transaction;
    const wrappedDb = {
      ...mockDb,
      query: {
        ...(mockDb as unknown as { query?: Record<string, unknown> }).query,
        featureFlags: {
          findFirst: async () => ({ defaultOn: true, killSwitch: false }),
        },
        tenantFeatureOverrides: {
          findFirst: async () => undefined,
        },
      },
      select: (mockDb as unknown as { select?: unknown }).select ?? (() => ({
        from: () => ({
          where: () => ({
            limit: () => [{ defaultOn: true, killSwitch: false }],
          }),
        }),
      })),
      execute: (mockDb as unknown as { execute?: unknown }).execute ?? (async () => {}),
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
        if (!origTx) return cb(wrappedDb);
        return origTx(async (tx: unknown) => {
          const augmentedTx = {
            ...(tx as Record<string, unknown>),
            query: {
              ...((tx as { query?: Record<string, unknown> }).query ?? {}),
              tenantFeatureOverrides: {
                findFirst: async () => undefined,
              },
            },
          };
          return cb(augmentedTx);
        });
      },
    };
    return {
      service: "web",
      _db: { db: wrappedDb as unknown as Db, pool: {} as never, close: async () => {} },
      close: async () => {},
    };
  };

  describe("getStorefrontProduct", () => {
    it("returns null for non-existent or unpublished or deleted product", async () => {
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {},
            select: () => ({
              from: () => ({
                leftJoin: () => ({
                  where: () => ({
                    limit: () => [],
                  }),
                }),
              }),
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const product = await getStorefrontProduct(rt, publicCtx, "non-existent-or-draft");
      expect(product).toBeNull();
    });

    it("returns published product with brand, media, options, and variants with stock status", async () => {
      const productId = "0199a000-0000-7000-8000-000000000010";

      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {},
            select: () => ({
              from: (_table: unknown) => {
                // If it's the product query
                return {
                  leftJoin: () => ({
                    where: () => ({
                      limit: () => [
                        {
                          product: {
                            id: productId,
                            tenantId,
                            title: "Wireless Headphones",
                            slug: "wireless-headphones",
                            status: "published",
                            descriptionJson: { type: "doc" },
                            shortDescription: "Great sound",
                            brandId: "0199a000-0000-7000-8000-000000000099",
                            productType: "Audio",
                            tags: ["audio", "bluetooth"],
                            seo: { title: "Wireless Headphones" },
                            requiresShipping: true,
                            isFeatured: true,
                            ratingAvg: "4.50",
                            ratingCount: 12,
                            deletedAt: null,
                            createdAt: new Date("2026-01-01"),
                            updatedAt: new Date("2026-01-02"),
                          },
                          brand: {
                            id: "0199a000-0000-7000-8000-000000000099",
                            name: "SoundMax",
                            slug: "soundmax",
                            logoMediaId: null,
                          },
                        },
                      ],
                    }),
                  }),
                  // Otherwise subsequent queries for media, options, variants, inventory
                  where: () => {
                    const rows = [
                      {
                        id: "med-1",
                        productId,
                        variantId: "med-1",
                        mediaId: "m-1",
                        position: 0,
                        alt: "Front view",
                        url: "https://cdn.example.com/front.jpg",
                        onHand: 10,
                        reserved: 2,
                        lowStockThreshold: 3,
                      },
                    ];
                    return Object.assign(rows, {
                      orderBy: () => rows,
                    });
                  },
                };
              },
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const product = await getStorefrontProduct(rt, publicCtx, "wireless-headphones");

      expect(product).not.toBeNull();
      expect(product?.slug).toBe("wireless-headphones");
      expect(product?.title).toBe("Wireless Headphones");
    });
  });

  describe("getStorefrontCollection", () => {
    it("returns collection details and paginated published products", async () => {
      const collectionId = "0199a000-0000-7000-8000-000000000100";
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {},
            select: () => ({
              from: () => ({
                where: () => {
                  const items = [
                    {
                      id: "prod-1",
                      title: "Summer Shirt",
                      slug: "summer-shirt",
                      status: "published",
                      deletedAt: null,
                    },
                  ];
                  return Object.assign(items, {
                    limit: () => [
                      {
                        id: collectionId,
                        title: "Summer Collection",
                        slug: "summer-collection",
                        type: "manual",
                        rules: null,
                        sortOrder: "manual",
                        imageMediaId: null,
                        seo: null,
                        published: true,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                      },
                    ],
                    orderBy: () => items,
                  });
                },
                innerJoin: () => ({
                  where: () => ({
                    orderBy: () => ({
                      limit: () => ({
                        offset: () => [
                          {
                            product: {
                              id: "prod-1",
                              title: "Summer Shirt",
                              slug: "summer-shirt",
                              status: "published",
                              deletedAt: null,
                            },
                          },
                        ],
                      }),
                    }),
                  }),
                }),
              }),
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const res = await getStorefrontCollection(rt, publicCtx, "summer-collection", {
        page: 1,
        limit: 10,
        sort: "price_asc",
        inStockOnly: true,
      });

      expect(res).not.toBeNull();
      expect(res?.collection.slug).toBe("summer-collection");
      expect(res?.products).toBeDefined();
    });
  });

  describe("getStorefrontCategory", () => {
    it("returns category details and paginated published products", async () => {
      const categoryId = "0199a000-0000-7000-8000-000000000200";
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {},
            select: () => ({
              from: () => ({
                where: () => {
                  const items = [
                    {
                      id: "prod-2",
                      title: "Smartphone",
                      slug: "smartphone",
                      status: "published",
                      deletedAt: null,
                    },
                  ];
                  return Object.assign(items, {
                    limit: () => [
                      {
                        id: categoryId,
                        parentId: null,
                        name: "Electronics",
                        slug: "electronics",
                        description: "Electronic gadgets",
                        position: 0,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                      },
                    ],
                    orderBy: () => items,
                  });
                },
                innerJoin: () => ({
                  where: () => ({
                    orderBy: () => ({
                      limit: () => ({
                        offset: () => [
                          {
                            product: {
                              id: "prod-2",
                              title: "Smartphone",
                              slug: "smartphone",
                              status: "published",
                              deletedAt: null,
                            },
                          },
                        ],
                      }),
                    }),
                  }),
                }),
              }),
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const res = await getStorefrontCategory(rt, publicCtx, "electronics", {
        page: 1,
        limit: 10,
      });

      expect(res).not.toBeNull();
      expect(res?.category.slug).toBe("electronics");
      expect(res?.products).toBeDefined();
    });
  });

  describe("searchStorefrontProducts & getSearchSuggestions", () => {
    it("returns empty result without db calls if search query is empty", async () => {
      let dbCalled = false;
      const mockDb = {
        transaction: async () => {
          dbCalled = true;
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const res = await searchStorefrontProducts(rt, publicCtx, "   ");
      expect(res).toEqual({ items: [], total: 0 });
      expect(dbCalled).toBe(false);
    });

    it("searches published products, ranks results, and logs search query", async () => {
      let queryLogged = false;
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {},
            select: () => ({
              from: () => ({
                where: () => {
                  const items = [
                    {
                      id: "prod-1",
                      title: "Wireless Mouse",
                      slug: "wireless-mouse",
                      shortDescription: "Ergonomic mouse",
                      status: "published",
                      ratingAvg: "4.20",
                      ratingCount: 5,
                    },
                  ];
                  return Object.assign(items, {
                    orderBy: () => Object.assign(items, {
                      limit: () => ({
                        offset: () => items,
                      }),
                    }),
                  });
                },
              }),
            }),
            insert: () => ({
              values: () => ({
                onConflictDoUpdate: () => {
                  queryLogged = true;
                  return Promise.resolve();
                },
              }),
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const res = await searchStorefrontProducts(rt, publicCtx, "wireless mouse");
      expect(res.items.length).toBe(1);
      expect(res.items[0]?.title).toBe("Wireless Mouse");
      expect(queryLogged).toBe(true);
    });

    it("returns suggestions for partial text", async () => {
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {},
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: () => [
                    { title: "Wireless Mouse", slug: "wireless-mouse" },
                    { title: "Wireless Keyboard", slug: "wireless-keyboard" },
                  ],
                }),
              }),
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const suggestions = await getSearchSuggestions(rt, publicCtx, "wire", 5);
      expect(suggestions).toEqual([
        { title: "Wireless Mouse", slug: "wireless-mouse" },
        { title: "Wireless Keyboard", slug: "wireless-keyboard" },
      ]);
    });
  });

  describe("price sorting", () => {
    it("sorts products by price_asc and price_desc", async () => {
      const collectionId = "0199a000-0000-7000-8000-000000000100";
      const createMockDb = (order: "asc" | "desc") =>
        ({
          transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
            return cb({
              execute: async () => {},
              select: () => ({
                from: () => ({
                  where: () => {
                    const variants = [
                      { productId: "prod-high", price: "100.00" },
                      { productId: "prod-low", price: "20.00" },
                    ];
                    return Object.assign(variants, {
                      limit: () => [
                        {
                          id: collectionId,
                          title: "Summer",
                          slug: "summer",
                          type: "manual",
                          rules: null,
                          sortOrder: "manual",
                          imageMediaId: null,
                          seo: null,
                          published: true,
                          createdAt: new Date(),
                          updatedAt: new Date(),
                        },
                      ],
                      orderBy: () => [],
                    });
                  },
                  innerJoin: () => ({
                    where: () => ({
                      orderBy: () => ({
                        limit: () => ({
                          offset: () =>
                            order === "asc"
                              ? [
                                  { product: { id: "prod-low", title: "Cheap Shirt", slug: "cheap-shirt", status: "published", deletedAt: null } },
                                  { product: { id: "prod-high", title: "Expensive Shirt", slug: "exp-shirt", status: "published", deletedAt: null } },
                                ]
                              : [
                                  { product: { id: "prod-high", title: "Expensive Shirt", slug: "exp-shirt", status: "published", deletedAt: null } },
                                  { product: { id: "prod-low", title: "Cheap Shirt", slug: "cheap-shirt", status: "published", deletedAt: null } },
                                ],
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            });
          },
        }) as unknown as Db;

      const ascRt = createMockRuntime(createMockDb("asc"));
      const ascRes = await getStorefrontCollection(ascRt, publicCtx, "summer", {
        sort: "price_asc",
      });
      expect(ascRes?.products.items.map((i) => i.id)).toEqual(["prod-low", "prod-high"]);

      const descRt = createMockRuntime(createMockDb("desc"));
      const descRes = await getStorefrontCollection(descRt, publicCtx, "summer", {
        sort: "price_desc",
      });
      expect(descRes?.products.items.map((i) => i.id)).toEqual(["prod-high", "prod-low"]);
    });
  });
});

