import { describe, expect, it } from "vitest";
import { type Db, shippingZones, shippingRates } from "@bs/db";
import type { Runtime, TenantContext } from "../src/index.ts";
import {
  getOrCreateCart,
  addToCart,
  updateCartItemQuantity,
  removeCartItem,
  clearCart,
  estimateCartShipping,
  subscribeNewsletter,
} from "../src/index.ts";

describe("Storefront Cart & Newsletter Services", () => {
  const tenantId = "0199a000-0000-7000-8000-000000000001";

  const publicCtx: TenantContext = {
    tenantId,
    storeStatus: "live",
    actor: { type: "anonymous" },
    roles: [],
    permissions: [],
    requestId: "req-cart-1",
  };

  const createMockRuntime = (mockDb: Db): Runtime => ({
    service: "web",
    _db: { db: mockDb, pool: {} as never, close: async () => {} },
    close: async () => {},
  });

  describe("Cart Lifecycle", () => {
    it("creates a new cart with generated token when no token or unrecognised token is provided", async () => {
      let insertedCart: Record<string, unknown> | null = null;
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            execute: async () => {},
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: () => [], // cart not found
                }),
                innerJoin: () => ({
                  innerJoin: () => ({
                    leftJoin: () => ({
                      leftJoin() {
                        return this; // the cart query joins product media, then the media row for its public url
                      },
                      where: () => ({
                        orderBy: () => [],
                      }),
                    }),
                  }),
                }),
              }),
            }),
            insert: () => ({
              values: (val: { token?: string }) => {
                insertedCart = {
                  id: "cart-new-id-1",
                  token: val.token ?? "gen-token-1",
                  tenantId,
                  currency: "INR",
                  status: "active",
                  lastActivityAt: new Date(),
                  createdAt: new Date(),
                };
                return {
                  returning: () => [insertedCart],
                };
              },
            }),
          };
          return cb(tx);
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const cart = await getOrCreateCart(rt, publicCtx);

      expect(cart).toBeDefined();
      expect(cart.id).toBe("cart-new-id-1");
      expect(cart.token).toBeDefined();
      expect(cart.items).toEqual([]);
      expect(cart.itemCount).toBe(0);
      expect(cart.subtotal).toBe(0);
    });

    it("retrieves existing cart with joined items, calculates line totals and subtotal", async () => {
      const mockCart = {
        id: "cart-1",
        token: "token-abc-123",
        currency: "INR",
        status: "active",
        lastActivityAt: new Date("2026-09-28T00:00:00Z"),
        createdAt: new Date("2026-09-28T00:00:00Z"),
      };

      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            execute: async () => {},
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: () => [mockCart],
                  orderBy: () => [],
                }),
                innerJoin: () => ({
                  innerJoin: () => ({
                    leftJoin: () => ({
                      leftJoin() {
                        return this; // the cart query joins product media, then the media row for its public url
                      },
                      where: () => ({
                        orderBy: () => [
                          {
                            item: {
                              id: "item-1",
                              cartId: "cart-1",
                              variantId: "variant-1",
                              quantity: 2,
                              unitPriceSnapshot: 15000,
                              properties: { color: "red" },
                              createdAt: new Date("2026-09-28T00:00:00Z"),
                              updatedAt: new Date("2026-09-28T00:00:00Z"),
                            },
                            variant: {
                              id: "variant-1",
                              sku: "SKU-RED-1",
                              title: "Red T-Shirt",
                              optionValues: { Color: "Red" },
                              price: 15000n,
                            },
                            product: {
                              id: "prod-1",
                              title: "Classic T-Shirt",
                              slug: "classic-t-shirt",
                            },
                            primaryMedia: {
                              mediaId: "media-1",
                              alt: "Red T-Shirt front",
                            },
                          },
                          {
                            item: {
                              id: "item-2",
                              cartId: "cart-1",
                              variantId: "variant-2",
                              quantity: 1,
                              unitPriceSnapshot: 25000,
                              properties: null,
                              createdAt: new Date("2026-09-28T00:00:00Z"),
                              updatedAt: new Date("2026-09-28T00:00:00Z"),
                            },
                            variant: {
                              id: "variant-2",
                              sku: "SKU-BLUE-2",
                              title: "Blue Jeans",
                              optionValues: { Size: "32" },
                              price: 25000n,
                            },
                            product: {
                              id: "prod-2",
                              title: "Denim Jeans",
                              slug: "denim-jeans",
                            },
                            primaryMedia: null,
                          },
                        ],
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
          return cb(tx);
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const cart = await getOrCreateCart(rt, publicCtx, "token-abc-123");

      expect(cart.id).toBe("cart-1");
      expect(cart.token).toBe("token-abc-123");
      expect(cart.items).toHaveLength(2);
      expect(cart.itemCount).toBe(3); // 2 + 1
      expect(cart.subtotal).toBe(55000); // (15000 * 2) + (25000 * 1) = 30000 + 25000
      expect(cart.items[0]?.lineTotal).toBe(30000);
      expect(cart.items[0]?.product.title).toBe("Classic T-Shirt");
      expect(cart.items[0]?.variant.sku).toBe("SKU-RED-1");
      expect(cart.items[0]?.primaryImage?.mediaId).toBe("media-1");
      expect(cart.items[1]?.lineTotal).toBe(25000);
      expect(cart.items[1]?.primaryImage).toBeNull();
    });

    it("addToCart rejects non-positive quantity", async () => {
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({} as unknown),
      } as unknown as Db;
      const rt = createMockRuntime(mockDb);

      await expect(
        addToCart(rt, publicCtx, {
          token: "token-1",
          variantId: "var-1",
          quantity: 0,
        }),
      ).rejects.toThrow("Quantity must be greater than zero");
    });

    it("addToCart rejects if variant does not exist or product is not published", async () => {
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            execute: async () => {},
            select: () => ({
              from: () => ({
                innerJoin: () => ({
                  where: () => ({
                    limit: () => [], // variant + published product not found
                  }),
                }),
                where: () => ({
                  limit: () => [{ id: "cart-1", token: "token-1" }],
                }),
              }),
            }),
          };
          return cb(tx);
        },
      } as unknown as Db;
      const rt = createMockRuntime(mockDb);

      await expect(
        addToCart(rt, publicCtx, {
          token: "token-1",
          variantId: "non-existent-var",
          quantity: 1,
        }),
      ).rejects.toThrow("Variant not found or product is not available");
    });

    it("addToCart increments existing item quantity or inserts new item", async () => {
      let inserted = false;
      let updated = false;

      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            execute: async () => {},
            select: () => ({
              from: () => ({
                innerJoin: () => ({
                  innerJoin: () => ({
                    leftJoin: () => ({
                      leftJoin() {
                        return this; // the cart query joins product media, then the media row for its public url
                      },
                      where: () => ({
                        orderBy: () => [],
                      }),
                    }),
                  }),
                  where: () => ({
                    limit: () => [
                      {
                        variant: {
                          id: "var-1",
                          price: 49900n,
                        },
                        product: {
                          id: "prod-1",
                          status: "published",
                          deletedAt: null,
                        },
                      },
                    ],
                  }),
                }),
                where: () => ({
                  limit: () => [{ id: "cart-1", token: "token-1", status: "active" }],
                }),
              }),
            }),
            insert: () => ({
              values: () => ({
                onConflictDoUpdate: () => {
                  inserted = true;
                  return {
                    returning: () => [{ id: "item-1", quantity: 2 }],
                  };
                },
              }),
            }),
            update: () => ({
              set: () => {
                updated = true;
                return {
                  where: () => ({}),
                };
              },
            }),
          };
          return cb(tx);
        },
      } as unknown as Db;
      const rt = createMockRuntime(mockDb);

      const cart = await addToCart(rt, publicCtx, {
        token: "token-1",
        variantId: "var-1",
        quantity: 2,
      });

      expect(cart).toBeDefined();
      expect(inserted).toBe(true);
      expect(updated).toBe(true); // lastActivityAt updated
    });

    it("updateCartItemQuantity removes item when quantity is 0 or less", async () => {
      let deleted = false;
      let updatedCartActivity = false;

      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            execute: async () => {},
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: () => [{ id: "cart-1", token: "token-1" }],
                }),
                innerJoin: () => ({
                  innerJoin: () => ({
                    leftJoin: () => ({
                      leftJoin() {
                        return this; // the cart query joins product media, then the media row for its public url
                      },
                      where: () => ({
                        orderBy: () => [],
                      }),
                    }),
                  }),
                }),
              }),
            }),
            delete: () => ({
              where: () => {
                deleted = true;
                return {};
              },
            }),
            update: () => ({
              set: () => {
                updatedCartActivity = true;
                return { where: () => ({}) };
              },
            }),
          };
          return cb(tx);
        },
      } as unknown as Db;
      const rt = createMockRuntime(mockDb);

      const res = await updateCartItemQuantity(rt, publicCtx, {
        token: "token-1",
        itemId: "item-1",
        quantity: 0,
      });

      expect(res).toBeDefined();
      expect(deleted).toBe(true);
      expect(updatedCartActivity).toBe(true);
    });

    it("removeCartItem deletes item from cart", async () => {
      let deleted = false;

      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            execute: async () => {},
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: () => [{ id: "cart-1", token: "token-1" }],
                }),
                innerJoin: () => ({
                  innerJoin: () => ({
                    leftJoin: () => ({
                      leftJoin() {
                        return this; // the cart query joins product media, then the media row for its public url
                      },
                      where: () => ({
                        orderBy: () => [],
                      }),
                    }),
                  }),
                }),
              }),
            }),
            delete: () => ({
              where: () => {
                deleted = true;
                return {};
              },
            }),
            update: () => ({
              set: () => ({
                where: () => ({}),
              }),
            }),
          };
          return cb(tx);
        },
      } as unknown as Db;
      const rt = createMockRuntime(mockDb);

      const res = await removeCartItem(rt, publicCtx, {
        token: "token-1",
        itemId: "item-1",
      });

      expect(res).toBeDefined();
      expect(deleted).toBe(true);
    });

    it("clearCart deletes all items for the cart", async () => {
      let cleared = false;

      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            execute: async () => {},
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: () => [{ id: "cart-1", token: "token-1" }],
                }),
                innerJoin: () => ({
                  innerJoin: () => ({
                    leftJoin: () => ({
                      leftJoin() {
                        return this; // the cart query joins product media, then the media row for its public url
                      },
                      where: () => ({
                        orderBy: () => [],
                      }),
                    }),
                  }),
                }),
              }),
            }),
            delete: () => ({
              where: () => {
                cleared = true;
                return {};
              },
            }),
            update: () => ({
              set: () => ({
                where: () => ({}),
              }),
            }),
          };
          return cb(tx);
        },
      } as unknown as Db;
      const rt = createMockRuntime(mockDb);

      const res = await clearCart(rt, publicCtx, "token-1");
      expect(res).toBeDefined();
      expect(cleared).toBe(true);
    });
  });

  describe("Shipping Estimation", () => {
    it("validates Indian pincode format (6 digits, non-zero starting)", async () => {
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {},
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: () => [{ id: "cart-1", token: "token-1" }],
                }),
                innerJoin: () => ({
                  innerJoin: () => ({
                    leftJoin: () => ({
                      leftJoin() {
                        return this; // the cart query joins product media, then the media row for its public url
                      },
                      where: () => ({
                        orderBy: () => [],
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

      await expect(
        estimateCartShipping(rt, publicCtx, { token: "token-1", pincode: "012345" }),
      ).rejects.toThrow("Invalid Indian pincode format");

      await expect(
        estimateCartShipping(rt, publicCtx, { token: "token-1", pincode: "12345" }),
      ).rejects.toThrow("Invalid Indian pincode format");

      await expect(
        estimateCartShipping(rt, publicCtx, { token: "token-1", pincode: "abcde1" }),
      ).rejects.toThrow("Invalid Indian pincode format");
    });

    it("calculates standard and express shipping rates with free shipping threshold", async () => {
      const defaultZone = { id: "zone-1", tenantId, name: "Domestic (India)", isDefault: true };
      const configuredRates = [
        {
          id: "rate-1",
          tenantId,
          zoneId: "zone-1",
          name: "Standard Delivery",
          method: "standard",
          rateType: "flat",
          pricePaise: 5000,
          thresholdPaise: 99900,
          minDays: 4,
          maxDays: 7,
        },
        {
          id: "rate-2",
          tenantId,
          zoneId: "zone-1",
          name: "Express Delivery",
          method: "express",
          rateType: "flat",
          pricePaise: 12000,
          thresholdPaise: null,
          minDays: 2,
          maxDays: 3,
        },
      ];

      const createCartMockDb = (cartItemsList: unknown[]) =>
        ({
          transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
            return cb({
              execute: async () => {},
              select: () => ({
                from: (table: unknown) => {
                  if (table === shippingZones) {
                    return {
                      where: () => ({
                        orderBy: () => [defaultZone],
                      }),
                    };
                  }
                  if (table === shippingRates) {
                    return {
                      where: () => ({
                        orderBy: () => configuredRates,
                      }),
                    };
                  }
                  return {
                    where: () => ({
                      limit: () => [{ id: "cart-1", token: "token-1" }],
                    }),
                    innerJoin: () => ({
                      innerJoin: () => ({
                        leftJoin: () => ({
                          leftJoin() {
                            return this; // the cart query joins product media, then the media row for its public url
                          },
                          where: () => ({
                            orderBy: () => cartItemsList,
                          }),
                        }),
                      }),
                    }),
                  };
                },
              }),
            });
          },
        }) as unknown as Db;

      // Subtotal < 99900 paise: Standard ₹5000, Express ₹12000
      const mockDbSubtotalLow = createCartMockDb([
        {
          item: {
            id: "item-1",
            cartId: "cart-1",
            variantId: "variant-1",
            quantity: 1,
            unitPriceSnapshot: 50000, // ₹500
          },
          variant: { id: "variant-1", sku: "S1", title: "V1", price: 50000n },
          product: { id: "p1", title: "P1", slug: "p1" },
          primaryMedia: null,
        },
      ]);

      const rtLow = createMockRuntime(mockDbSubtotalLow);
      const estLow = await estimateCartShipping(rtLow, publicCtx, {
        token: "token-1",
        pincode: "560001",
      });

      expect(estLow.serviceable).toBe(true);
      expect(estLow.pincode).toBe("560001");
      expect(estLow.rates).toHaveLength(2);
      const standardLow = estLow.rates.find((r) => r.id === "standard");
      expect(standardLow?.amount).toBe(5000);
      const expressLow = estLow.rates.find((r) => r.id === "express");
      expect(expressLow?.amount).toBe(12000);

      // Subtotal >= 99900 paise: Standard ₹0 (Free), Express ₹12000
      const mockDbSubtotalHigh = createCartMockDb([
        {
          item: {
            id: "item-1",
            cartId: "cart-1",
            variantId: "variant-1",
            quantity: 2,
            unitPriceSnapshot: 60000, // ₹600 * 2 = ₹1200 (120000 paise >= 99900)
          },
          variant: { id: "variant-1", sku: "S1", title: "V1", price: 60000n },
          product: { id: "p1", title: "P1", slug: "p1" },
          primaryMedia: null,
        },
      ]);

      const rtHigh = createMockRuntime(mockDbSubtotalHigh);
      const estHigh = await estimateCartShipping(rtHigh, publicCtx, {
        token: "token-1",
        pincode: "110001",
      });

      const standardHigh = estHigh.rates.find((r) => r.id === "standard");
      expect(standardHigh?.amount).toBe(0);
      const expressHigh = estHigh.rates.find((r) => r.id === "express");
      expect(expressHigh?.amount).toBe(12000);
    });
  });

  describe("Newsletter Subscription", () => {
    it("subscribes new email or handles conflict with upsert", async () => {
      const inserted: { email?: string | undefined; source?: string | undefined } = {};
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            execute: async () => {},
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: () => [{ id: "cust-1", email: "customer@example.com", acceptsMarketing: false, marketingState: "not_subscribed" }],
                }),
              }),
            }),
            insert: () => ({
              values: (val: Record<string, unknown>) => {
                if (val.email && typeof val.email === "string") {
                  inserted.email = val.email;
                  inserted.source = val.source as string;
                }
                return {
                  returning: () => [{ id: "cust-1", email: val.email, acceptsMarketing: true, marketingState: "subscribed" }],
                  onConflictDoUpdate: () => ({
                    returning: () => [{ id: "sub-1", email: val.email, status: "subscribed" }],
                  }),
                };
              },
            }),
            update: () => ({
              set: () => ({
                where: () => ({}),
              }),
            }),
          });
        },
      } as unknown as Db;

      const rt = createMockRuntime(mockDb);
      const res = await subscribeNewsletter(rt, publicCtx, {
        email: "customer@example.com",
        source: "footer",
      });

      expect(res.success).toBe(true);
      expect(res.message).toBe("Subscribed successfully");
      expect(inserted.email).toBe("customer@example.com");
    });

    it("rejects invalid email format", async () => {
      const mockDb = {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({} as unknown),
      } as unknown as Db;
      const rt = createMockRuntime(mockDb);

      await expect(
        subscribeNewsletter(rt, publicCtx, {
          email: "invalid-email-address",
        }),
      ).rejects.toThrow("Invalid email address");
    });
  });
});
