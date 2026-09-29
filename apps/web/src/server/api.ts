import "server-only";
import { Hono } from "hono";
import { implement, onError, ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { storeContract } from "@bs/contracts";
import { hasPermission, type StorePermission } from "@bs/auth";
import {
  adjustInventory,
  buildTenantContext,
  checkHealth,
  createBrand,
  createCategory,
  createCollection,
  createMediaRecord,
  createMenu,
  createPage,
  createProduct,
  deleteBrand,
  deleteCategory,
  deleteCollection,
  deleteMediaRecord,
  deleteMenu,
  deleteProduct,
  getBrandSettings,
  getCollection,
  getMenu,
  getPage,
  getProduct,
  getStoreSettings,
  getTheme,
  inviteStaff,
  listBrands,
  listCategories,
  listCollections,
  listInventoryLevels,
  listMedia,
  listMemberships,
  listMenus,
  listPages,
  listProducts,
  listStoreFeatureFlags,
  publishBrandSettings,
  publishPage,
  requestLogger,
  requestMediaUpload,
  resolveRequestId,
  rollbackPage,
  savePageDraft,
  updateBrand,
  updateBrandSettings,
  updateCategory,
  updateCollection,
  updateMenu,
  updatePage,
  updateProduct,
  updateStoreSettings,
  updateTheme,
  updateVariant,
  searchStorefrontProducts,
  getSearchSuggestions,
  getOrCreateCart,
  addToCart,
  updateCartItemQuantity,
  removeCartItem,
  clearCart,
  estimateCartShipping,
  subscribeNewsletter,
  verifyStorefrontPassword,
  listAdminOrders,
  getAdminOrderDetail,
  createAdminDraftOrder,
  addAdminOrderNote,
  cancelAdminOrder,
  refundAdminOrder,
  createAdminFulfillment,
  createAdminOrderInvoice,
  listAdminCustomers,
  getAdminCustomerDetail,
  listAdminDiscounts,
  createAdminDiscount,
  updateAdminDiscount,
  deleteAdminDiscount,
  FeatureDisabledError,
  type Logger,
  type Runtime,
  type TenantContext,
} from "@bs/domain";
import { server } from "./runtime.ts";

/**
 * Store API mounted inside Next at /api (PLAN §3). Route handlers never touch the DB:
 * procedures call domain services with the runtime and TenantContext.
 */
export interface ApiContext {
  rt: Runtime;
  log: Logger;
  headers?: Headers | undefined;
  session?: {
    user: { id: string; email?: string | undefined };
    session?: { id: string; userId: string; [key: string]: unknown } | undefined;
    type?: "staff" | "customer" | undefined;
  } | null | undefined;
  tenantCtx?: TenantContext | undefined;
}

const os = implement(storeContract).$context<ApiContext>();

const requireAdmin = os.middleware(async ({ context, next }) => {
  const headers = context.headers ?? new Headers();
  const tenantCtx = await buildTenantContext(context.rt, {
    entryPath: "admin",
    headers,
    session: context.session,
  });

  if (!tenantCtx) {
    throw new Error("Unauthorized: unable to resolve admin tenant context");
  }

  return next({
    context: {
      ...context,
      tenantCtx,
    },
  });
});

const requireStorefront = os.middleware(async ({ context, next }) => {
  const headers = context.headers ?? new Headers();
  const tenantCtx = await buildTenantContext(context.rt, {
    entryPath: "storefront",
    headers,
    session: context.session,
  });
  if (!tenantCtx) {
    throw new Error("Unable to resolve storefront tenant from host");
  }
  return next({
    context: {
      ...context,
      tenantCtx,
    },
  });
});

const requirePermission = (needed: StorePermission) =>
  os.middleware(async ({ context, next }) => {
    if (!context.tenantCtx) {
      throw new Error("Unauthorized: missing tenant context");
    }
    if (!hasPermission(context.tenantCtx.permissions, needed)) {
      throw new Error(`Forbidden: missing required permission '${needed}'`);
    }
    return next({
      context: {
        ...context,
        tenantCtx: context.tenantCtx as TenantContext,
      },
    });
  });

export const storeRouter = os.router({
  system: {
    health: os.system.health.handler(({ context }) => checkHealth(context.rt)),
  },
  admin: {
    memberships: {
      list: os.admin.memberships.list
        .use(requireAdmin)
        .use(requirePermission("staff.manage"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listMemberships(context.rt, context.tenantCtx);
        }),
      invite: os.admin.memberships.invite
        .use(requireAdmin)
        .use(requirePermission("staff.manage"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return inviteStaff(context.rt, context.tenantCtx, input);
        }),
    },
    settings: {
      get: os.admin.settings.get
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getStoreSettings(context.rt, context.tenantCtx);
        }),
      update: os.admin.settings.update
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return updateStoreSettings(context.rt, context.tenantCtx, input);
        }),
    },
    featureFlags: {
      list: os.admin.featureFlags.list
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listStoreFeatureFlags(context.rt, context.tenantCtx);
        }),
    },

    // Catalog: Products
    products: {
      list: os.admin.products.list
        .use(requireAdmin)
        .use(requirePermission("products.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listProducts(context.rt, context.tenantCtx, input);
        }),
      get: os.admin.products.get
        .use(requireAdmin)
        .use(requirePermission("products.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getProduct(context.rt, context.tenantCtx, input);
        }),
      create: os.admin.products.create
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return createProduct(context.rt, context.tenantCtx, input);
        }),
      update: os.admin.products.update
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return updateProduct(context.rt, context.tenantCtx, input);
        }),
      delete: os.admin.products.delete
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return deleteProduct(context.rt, context.tenantCtx, input);
        }),
    },

    // Catalog: Variants
    variants: {
      update: os.admin.variants.update
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return updateVariant(context.rt, context.tenantCtx, input);
        }),
    },

    // Catalog: Categories
    categories: {
      list: os.admin.categories.list
        .use(requireAdmin)
        .use(requirePermission("products.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listCategories(context.rt, context.tenantCtx, input);
        }),
      create: os.admin.categories.create
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return createCategory(context.rt, context.tenantCtx, input);
        }),
      update: os.admin.categories.update
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return updateCategory(context.rt, context.tenantCtx, input);
        }),
      delete: os.admin.categories.delete
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return deleteCategory(context.rt, context.tenantCtx, input);
        }),
    },

    // Catalog: Collections
    collections: {
      list: os.admin.collections.list
        .use(requireAdmin)
        .use(requirePermission("products.read"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listCollections(context.rt, context.tenantCtx);
        }),
      get: os.admin.collections.get
        .use(requireAdmin)
        .use(requirePermission("products.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getCollection(context.rt, context.tenantCtx, input);
        }),
      create: os.admin.collections.create
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return createCollection(context.rt, context.tenantCtx, input);
        }),
      update: os.admin.collections.update
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return updateCollection(context.rt, context.tenantCtx, input);
        }),
      delete: os.admin.collections.delete
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return deleteCollection(context.rt, context.tenantCtx, input);
        }),
    },

    // Catalog: Brands
    brands: {
      list: os.admin.brands.list
        .use(requireAdmin)
        .use(requirePermission("products.read"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listBrands(context.rt, context.tenantCtx);
        }),
      create: os.admin.brands.create
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return createBrand(context.rt, context.tenantCtx, input);
        }),
      update: os.admin.brands.update
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return updateBrand(context.rt, context.tenantCtx, input);
        }),
      delete: os.admin.brands.delete
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return deleteBrand(context.rt, context.tenantCtx, input);
        }),
    },

    // Inventory
    inventory: {
      list: os.admin.inventory.list
        .use(requireAdmin)
        .use(requirePermission("products.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listInventoryLevels(context.rt, context.tenantCtx, input);
        }),
      adjust: os.admin.inventory.adjust
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return adjustInventory(context.rt, context.tenantCtx, input);
        }),
    },

    // Media
    media: {
      list: os.admin.media.list
        .use(requireAdmin)
        .use(requirePermission("content.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listMedia(context.rt, context.tenantCtx, input);
        }),
      requestUpload: os.admin.media.requestUpload
        .use(requireAdmin)
        .use(requirePermission("content.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return requestMediaUpload(context.rt, context.tenantCtx, input);
        }),
      create: os.admin.media.create
        .use(requireAdmin)
        .use(requirePermission("content.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return createMediaRecord(context.rt, context.tenantCtx, input);
        }),
      delete: os.admin.media.delete
        .use(requireAdmin)
        .use(requirePermission("content.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return deleteMediaRecord(context.rt, context.tenantCtx, input);
        }),
    },

    // Branding
    branding: {
      get: os.admin.branding.get
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getBrandSettings(context.rt, context.tenantCtx);
        }),
      update: os.admin.branding.update
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return updateBrandSettings(context.rt, context.tenantCtx, input);
        }),
      publish: os.admin.branding.publish
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return publishBrandSettings(context.rt, context.tenantCtx);
        }),
    },

    // Themes
    themes: {
      get: os.admin.themes.get
        .use(requireAdmin)
        .use(requirePermission("content.write"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getTheme(context.rt, context.tenantCtx);
        }),
      update: os.admin.themes.update
        .use(requireAdmin)
        .use(requirePermission("theme.publish"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return updateTheme(context.rt, context.tenantCtx, input);
        }),
    },

    // Pages
    pages: {
      list: os.admin.pages.list
        .use(requireAdmin)
        .use(requirePermission("content.write"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listPages(context.rt, context.tenantCtx);
        }),
      get: os.admin.pages.get
        .use(requireAdmin)
        .use(requirePermission("content.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getPage(context.rt, context.tenantCtx, input);
        }),
      create: os.admin.pages.create
        .use(requireAdmin)
        .use(requirePermission("content.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return createPage(context.rt, context.tenantCtx, input);
        }),
      update: os.admin.pages.update
        .use(requireAdmin)
        .use(requirePermission("content.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return updatePage(context.rt, context.tenantCtx, input);
        }),
      saveDraft: os.admin.pages.saveDraft
        .use(requireAdmin)
        .use(requirePermission("content.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return savePageDraft(context.rt, context.tenantCtx, input);
        }),
      publish: os.admin.pages.publish
        .use(requireAdmin)
        .use(requirePermission("theme.publish"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return publishPage(context.rt, context.tenantCtx, input);
        }),
      rollback: os.admin.pages.rollback
        .use(requireAdmin)
        .use(requirePermission("theme.publish"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return rollbackPage(context.rt, context.tenantCtx, input);
        }),
    },

    // Menus
    menus: {
      list: os.admin.menus.list
        .use(requireAdmin)
        .use(requirePermission("content.write"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listMenus(context.rt, context.tenantCtx);
        }),
      get: os.admin.menus.get
        .use(requireAdmin)
        .use(requirePermission("content.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getMenu(context.rt, context.tenantCtx, input);
        }),
      create: os.admin.menus.create
        .use(requireAdmin)
        .use(requirePermission("content.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return createMenu(context.rt, context.tenantCtx, input);
        }),
      update: os.admin.menus.update
        .use(requireAdmin)
        .use(requirePermission("content.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return updateMenu(context.rt, context.tenantCtx, input);
        }),
      delete: os.admin.menus.delete
        .use(requireAdmin)
        .use(requirePermission("content.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return deleteMenu(context.rt, context.tenantCtx, input);
        }),
    },

    // --- M5 Orders Admin ---
    orders: {
      list: os.admin.orders.list
        .use(requireAdmin)
        .use(requirePermission("orders.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listAdminOrders(context.rt, context.tenantCtx, input);
        }),
      get: os.admin.orders.get
        .use(requireAdmin)
        .use(requirePermission("orders.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getAdminOrderDetail(context.rt, context.tenantCtx, input);
        }),
      createDraft: os.admin.orders.createDraft
        .use(requireAdmin)
        .use(requirePermission("orders.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return createAdminDraftOrder(context.rt, context.tenantCtx, input);
        }),
      addNote: os.admin.orders.addNote
        .use(requireAdmin)
        .use(requirePermission("orders.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return addAdminOrderNote(context.rt, context.tenantCtx, input);
        }),
      cancel: os.admin.orders.cancel
        .use(requireAdmin)
        .use(requirePermission("orders.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return cancelAdminOrder(context.rt, context.tenantCtx, input);
        }),
      refund: os.admin.orders.refund
        .use(requireAdmin)
        .use(requirePermission("orders.refund"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return refundAdminOrder(context.rt, context.tenantCtx, input);
        }),
      createFulfillment: os.admin.orders.createFulfillment
        .use(requireAdmin)
        .use(requirePermission("orders.write"))
        .handler(async ({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          try {
            return await createAdminFulfillment(context.rt, context.tenantCtx, input);
          } catch (err: unknown) {
            if (
              err instanceof FeatureDisabledError ||
              (typeof err === "object" && err !== null && (err as { statusCode?: number }).statusCode === 503) ||
              (err instanceof Error && /disabled/i.test(err.message))
            ) {
              throw new ORPCError("SERVICE_UNAVAILABLE", {
                message: err instanceof Error ? err.message : "Fulfillment is currently disabled for this store",
              });
            }
            throw err;
          }
        }),
      createInvoice: os.admin.orders.createInvoice
        .use(requireAdmin)
        .use(requirePermission("orders.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return createAdminOrderInvoice(context.rt, context.tenantCtx, input);
        }),
    },

    // --- M5 Customers Admin ---
    customers: {
      list: os.admin.customers.list
        .use(requireAdmin)
        .use(requirePermission("customers.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listAdminCustomers(context.rt, context.tenantCtx, input);
        }),
      get: os.admin.customers.get
        .use(requireAdmin)
        .use(requirePermission("customers.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getAdminCustomerDetail(context.rt, context.tenantCtx, input);
        }),
    },

    // --- M5 Discounts Admin ---
    discounts: {
      list: os.admin.discounts.list
        .use(requireAdmin)
        .use(requirePermission("discounts.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listAdminDiscounts(context.rt, context.tenantCtx, input);
        }),
      create: os.admin.discounts.create
        .use(requireAdmin)
        .use(requirePermission("discounts.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return createAdminDiscount(context.rt, context.tenantCtx, input);
        }),
      update: os.admin.discounts.update
        .use(requireAdmin)
        .use(requirePermission("discounts.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return updateAdminDiscount(context.rt, context.tenantCtx, input);
        }),
      delete: os.admin.discounts.delete
        .use(requireAdmin)
        .use(requirePermission("discounts.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return deleteAdminDiscount(context.rt, context.tenantCtx, input);
        }),
    },
  },
  storefront: {
    search: os.storefront.search
      .use(requireStorefront)
      .handler(async ({ context, input }) => {
        if (!context.tenantCtx) throw new Error("Missing tenant context");
        const res = await searchStorefrontProducts(context.rt, context.tenantCtx, input.query, {
          page: input.page,
          limit: input.limit,
        });
        return {
          total: res.total,
          items: res.items.map((item) => ({
            id: item.id,
            title: item.title,
            slug: item.slug,
            priceMin: item.priceMin,
            priceMax: item.priceMax,
            compareAtPriceMin: item.compareAtPriceMin ?? null,
            compareAtPriceMax: item.compareAtPriceMax ?? null,
            hasVariants: item.priceMin !== item.priceMax,
            primaryMedia: item.primaryImage
              ? {
                  id: item.primaryImage.mediaId,
                  storageKey: item.primaryImage.mediaId,
                  cfImageId: null,
                  alt: item.primaryImage.alt ?? null,
                  width: null,
                  height: null,
                }
              : null,
          })),
        };
      }),
    searchSuggestions: os.storefront.searchSuggestions
      .use(requireStorefront)
      .handler(async ({ context, input }) => {
        if (!context.tenantCtx) throw new Error("Missing tenant context");
        const items = await getSearchSuggestions(context.rt, context.tenantCtx, input.query, input.limit);
        return {
          suggestions: items.map((s) => ({
            id: s.slug,
            title: s.title,
            slug: s.slug,
          })),
        };
      }),
    cart: {
      get: os.storefront.cart.get
        .use(requireStorefront)
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getOrCreateCart(context.rt, context.tenantCtx, input.token);
        }),
      addItem: os.storefront.cart.addItem
        .use(requireStorefront)
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return addToCart(context.rt, context.tenantCtx, {
            token: input.token ?? "",
            variantId: input.variantId,
            quantity: input.quantity,
            properties: input.properties,
          });
        }),
      updateItem: os.storefront.cart.updateItem
        .use(requireStorefront)
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return updateCartItemQuantity(context.rt, context.tenantCtx, input);
        }),
      removeItem: os.storefront.cart.removeItem
        .use(requireStorefront)
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return removeCartItem(context.rt, context.tenantCtx, input);
        }),
      clear: os.storefront.cart.clear
        .use(requireStorefront)
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return clearCart(context.rt, context.tenantCtx, input.token);
        }),
      estimateShipping: os.storefront.cart.estimateShipping
        .use(requireStorefront)
        .handler(async ({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          const estimate = await estimateCartShipping(context.rt, context.tenantCtx, input);
          return {
            serviceable: estimate.serviceable,
            pincode: estimate.pincode,
            rates: estimate.rates.map((r) => ({
              id: r.id,
              name: r.title,
              amountPaise: r.amount,
              estimatedDays: r.estimatedDays,
            })),
          };
        }),
    },
    newsletter: {
      subscribe: os.storefront.newsletter.subscribe
        .use(requireStorefront)
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return subscribeNewsletter(context.rt, context.tenantCtx, input);
        }),
    },
    status: {
      verifyPassword: os.storefront.status.verifyPassword
        .use(requireStorefront)
        .handler(async ({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return verifyStorefrontPassword(context.rt, context.tenantCtx, input.password);
        }),
    },
  },
});

const logError = (error: unknown) => server().log.error({ err: error }, "store api error");
const rpc = new RPCHandler(storeRouter, { interceptors: [onError(logError)] });
const openapi = new OpenAPIHandler(storeRouter, { interceptors: [onError(logError)] });

type Env = { Variables: { requestId: string; log: Logger } };

export const api = new Hono<Env>().basePath("/api");

api.use("*", async (c, next) => {
  const requestId = resolveRequestId(c.req.header("x-request-id"));
  c.set("requestId", requestId);
  c.set("log", requestLogger(server().log, requestId));
  await next();
  c.header("x-request-id", requestId);
});

/** Liveness + DB readiness, used by Docker/Coolify health checks. */
api.get("/health", async (c) => {
  const h = await checkHealth(server().rt);
  return c.json(h, h.db.ok ? 200 : 503);
});

api.all("/rpc/*", async (c, next) => {
  const { matched, response } = await rpc.handle(c.req.raw, {
    prefix: "/api/rpc",
    context: { rt: server().rt, log: c.get("log"), headers: c.req.raw.headers },
  });
  if (matched) return c.newResponse(response.body, response);
  await next();
});

api.all("/*", async (c, next) => {
  const { matched, response } = await openapi.handle(c.req.raw, {
    prefix: "/api",
    context: { rt: server().rt, log: c.get("log"), headers: c.req.raw.headers },
  });
  if (matched) return c.newResponse(response.body, response);
  await next();
});
