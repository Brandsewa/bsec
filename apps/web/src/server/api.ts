import "server-only";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { implement, onError, ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { storeContract } from "@bs/contracts";
import { hasPermission, type StorePermission } from "@bs/auth";
import {
  adjustInventory,
  buildTenantContext,
  getAdminMe,
  getStoreStatus,
  attachProductMedia,
  detachProductMedia,
  updateStoreStatus,
  getSupportAdminMe,
  listStoreSupportSessions,
  approveStoreSupportSession,
  denyStoreSupportSession,
  getStandingSupportConsent,
  setStandingSupportConsent,
  acceptInvitation,
  checkRateLimit,
  clearLoginFailures,
  loginRetryAfter,
  recordLoginFailure,
  clearRazorpayCredentials,
  getPaymentsStatus,
  listInvitations,
  listStoreRoles,
  removeMember,
  revokeInvitation,
  saveRazorpayCredentials,
  setMemberRole,
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
  getSettingsOverview,
  listSettingsActivity,
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
  listPageVersions,
  listThemeLibrary,
  activateTheme,
  previewThemeTemplate,
  previewPageRenderData,
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
  getBrand,
  getBrandStats,
  updateBrandSettings,
  getCategory,
  getCategoryStats,
  updateCategory,
  getCollectionStats,
  updateCollection,
  listLocations,
  getLocationStats,
  getLocation,
  createLocation,
  updateLocation,
  deleteLocation,
  listAdminReviews,
  getAdminReviewStats,
  getAdminReviewDetail,
  publishAdminReview,
  holdAdminReview,
  deleteAdminReview,
  replyAdminReview,
  bulkPublishAdminReviews,
  bulkHoldAdminReviews,
  bulkDeleteAdminReviews,
  getStorefrontReviews,
  submitProductReview,
  updateMenu,
  updatePage,
  updateProduct,
  updateStoreSettings,
  updateTheme,
  updateVariant,
  getAdminShippingSettings,
  updateAdminShippingSettings,
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
  getAdminOrderStats,
  getAdminOrderDetail,
  estimateAdminDraftOrder,
  createAdminDraftOrder,
  getOrderSettings,
  updateOrderSettings,
  addAdminOrderNote,
  cancelAdminOrder,
  refundAdminOrder,
  createAdminFulfillment,
  confirmAdminOrder,
  advanceAdminOrder,
  listPreorders,
  getPreorderStats,
  changePreorderShipDate,
  releasePreorderNow,
  listAdminReturns,
  getAdminReturnStats,
  getAdminReturnDetail,
  actOnReturn,
  getReturnSettings,
  updateReturnSettings,
  submitQuoteRequest,
  getAdminQuoteStats,
  listAdminQuotes,
  getAdminQuoteDetail,
  updateAdminQuoteNote,
  markAdminQuoteLost,
  reopenAdminQuote,
  deleteAdminQuote,
  linkOrderToQuote,
  getAdminAbandonedCheckoutStats,
  listAdminAbandonedCheckouts,
  createAdminOrderInvoice,
  listAdminCustomers,
  getAdminCustomerDetail,
  createAdminCustomer,
  getAdminCustomerStats,
  listAdminCustomerTags,
  setAdminCustomerStatus,
  setAdminCustomerTags,
  updateAdminCustomer,
  setAdminCustomerConsent,
  addAdminCustomerAddress,
  updateAdminCustomerAddress,
  deleteAdminCustomerAddress,
  listAdminCustomerOrders,
  getAdminCustomerActivity,
  listCustomerNotes,
  addCustomerNote,
  deleteCustomerNote,
  previewCustomerImport,
  commitCustomerImport,
  deleteAdminCustomer,
  listAdminDiscounts,
  createAdminDiscount,
  updateAdminDiscount,
  deleteAdminDiscount,
  checkAdminApiRateLimit,
  checkStorefrontRateLimit,
  RateLimitExceededError,
  FeatureDisabledError,
  checkSubdomainAvailability,
  reserveSubdomain,
  saasDb,
  SaasNotConfiguredError,
  saveSignupLead,
  completeSignup,
  acceptTenantOwnerInvite,
  listPublicPlans,
  listPublicThemeTemplates,
  getOnboardingProgress,
  dismissOnboardingProgress,
  getTenantSubscription,
  changeTenantPlan,
  listTenantDomains,
  addCustomDomain,
  verifyCustomDomain,
  setPrimaryDomain,
  removeCustomDomain,
  checkInviteAcceptRateLimit,
  checkReserveSubdomainRateLimit,
  checkLeadCaptureRateLimit,
  checkPasswordResetRateLimit,
  checkResetPasswordConfirmRateLimit,
  sendPlatformEmail,
  renderEmail,
  hashIpWithSalt,
  type Logger,
  type Runtime,
  type TenantContext,
} from "@bs/domain";
import { server } from "./runtime.ts";
import { allowedApiOrigins, getStaffAuth, resolveStaffSession } from "./auth.ts";
import { isForbiddenStaffOrigin } from "./csrf.ts";
import { clientIp } from "./client-ip.ts";

/**
 * Store API mounted inside Next at /api (PLAN §3). Route handlers never touch the DB:
 * procedures call domain services with the runtime and TenantContext.
 */
export interface ApiContext {
  rt: Runtime;
  log: Logger;
  headers?: Headers | undefined;
  /** Method and path of the request (recorded when a platform support token is used). */
  requestInfo?: { method: string; path: string } | undefined;
  session?: {
    user: { id: string; email?: string | undefined };
    session?: { id: string; userId: string; [key: string]: unknown } | undefined;
    type?: "staff" | "customer" | undefined;
  } | null | undefined;
  tenantCtx?: TenantContext | undefined;
}

const os = implement(storeContract).$context<ApiContext>();

/** Domain code signals auth problems with "Unauthorized:/Forbidden:/Bad Request:" prefixes; map them to real HTTP-level codes. */
function mapAuthError(err: unknown): unknown {
  if (err instanceof Error) {
    const m = err.message;
    if (m.startsWith("Unauthorized")) return new ORPCError("UNAUTHORIZED", { message: m.replace(/^Unauthorized:\s*/, "") });
    if (m.startsWith("Forbidden")) return new ORPCError("FORBIDDEN", { message: m.replace(/^Forbidden:\s*/, "") });
    if (m.startsWith("Bad Request")) return new ORPCError("BAD_REQUEST", { message: m.replace(/^Bad Request:\s*/, "") });
    if (m.startsWith("Not Found")) return new ORPCError("NOT_FOUND", { message: m.replace(/^Not Found:\s*/, "") });
    if (m.startsWith("Conflict")) return new ORPCError("CONFLICT", { message: m.replace(/^Conflict:\s*/, "") });
    if (/^Invalid (order|fulfillment|return|payment)? ?(state )?transition/i.test(m)) return new ORPCError("PRECONDITION_FAILED", { message: m });
    if (m.startsWith("Precondition")) return new ORPCError("PRECONDITION_FAILED", { message: m.replace(/^Precondition:\s*/, "") });
  }
  return err;
}

const requireAdmin = os.middleware(async ({ context, next }) => {
  const headers = context.headers ?? new Headers();
  // Anonymous callers are refused before anything about the store is looked at (a missing store header must not turn a 401 into a 400).
  if ((!context.session || context.session.type === "customer") && !headers.get("x-support-token")) {
    throw new ORPCError("UNAUTHORIZED", { message: "Sign in required" });
  }
  let tenantCtx: TenantContext | null;
  try {
    tenantCtx = await buildTenantContext(context.rt, {
      entryPath: "admin",
      headers,
      session: context.session,
      request: context.requestInfo,
    });
  } catch (err) {
    throw mapAuthError(err);
  }

  if (!tenantCtx) {
    throw new ORPCError("UNAUTHORIZED", { message: "Unable to resolve admin tenant context" });
  }

  // Quota enforcement: Admin/API requests / min (PLAN §14)
  try {
    await checkAdminApiRateLimit(context.rt._db.db, tenantCtx.tenantId);
  } catch (err: unknown) {
    if (err instanceof RateLimitExceededError) {
      throw new ORPCError("TOO_MANY_REQUESTS", {
        message: err.message,
        data: { retryAfter: err.retryAfter },
      });
    }
    throw err;
  }

  try {
    return await next({
      context: {
        ...context,
        tenantCtx,
      },
    });
  } catch (err) {
    throw mapAuthError(err);
  }
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

  // Quota enforcement: Uncached storefront requests / min (PLAN §14)
  try {
    await checkStorefrontRateLimit(context.rt._db.db, tenantCtx.tenantId);
  } catch (err: unknown) {
    if (err instanceof RateLimitExceededError) {
      throw new ORPCError("TOO_MANY_REQUESTS", {
        message: err.message,
        data: { retryAfter: err.retryAfter },
      });
    }
    throw err;
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
      throw new ORPCError("FORBIDDEN", { message: `Missing required permission '${needed}'` });
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
    me: {
      get: os.admin.me.get.handler(async ({ context }) => {
        // A platform support session identifies itself with X-Support-Token instead of a store login.
        if (context.headers?.get("x-support-token")) {
          let tenantCtx: TenantContext | null;
          try {
            tenantCtx = await buildTenantContext(context.rt, {
              entryPath: "admin",
              headers: context.headers,
              session: null,
              request: context.requestInfo,
            });
          } catch (err) {
            throw mapAuthError(err);
          }
          if (!tenantCtx) throw new ORPCError("UNAUTHORIZED", { message: "Unable to resolve admin tenant context" });
          return getSupportAdminMe(context.rt, tenantCtx);
        }
        if (!context.session || context.session.type === "customer") {
          throw new ORPCError("UNAUTHORIZED", { message: "Sign in required" });
        }
        return getAdminMe(context.rt, context.session.user.id);
      }),
    },
    support: {
      list: os.admin.support.list
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listStoreSupportSessions(context.rt, context.tenantCtx).catch((e) => {
            throw mapAuthError(e);
          });
        }),
      approve: os.admin.support.approve
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return approveStoreSupportSession(context.rt, context.tenantCtx, input.id).catch((e) => {
            throw mapAuthError(e);
          });
        }),
      deny: os.admin.support.deny
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return denyStoreSupportSession(context.rt, context.tenantCtx, input.id).catch((e) => {
            throw mapAuthError(e);
          });
        }),
      getStandingConsent: os.admin.support.getStandingConsent
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getStandingSupportConsent(context.rt, context.tenantCtx).catch((e) => {
            throw mapAuthError(e);
          });
        }),
      setStandingConsent: os.admin.support.setStandingConsent
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return setStandingSupportConsent(context.rt, context.tenantCtx, input.enabled).catch((e) => {
            throw mapAuthError(e);
          });
        }),
    },
    payments: {
      get: os.admin.payments.get
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getPaymentsStatus(context.rt, context.tenantCtx);
        }),
      saveRazorpay: os.admin.payments.saveRazorpay
        .use(requireAdmin)
        .use(requirePermission("payments.manage"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return saveRazorpayCredentials(context.rt, context.tenantCtx, input);
        }),
      clearRazorpay: os.admin.payments.clearRazorpay
        .use(requireAdmin)
        .use(requirePermission("payments.manage"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return clearRazorpayCredentials(context.rt, context.tenantCtx);
        }),
    },
    memberships: {
      roles: os.admin.memberships.roles
        .use(requireAdmin)
        .use(requirePermission("staff.manage"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listStoreRoles(context.rt, context.tenantCtx);
        }),
      setRole: os.admin.memberships.setRole
        .use(requireAdmin)
        .use(requirePermission("staff.manage"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return setMemberRole(context.rt, context.tenantCtx, input);
        }),
      remove: os.admin.memberships.remove
        .use(requireAdmin)
        .use(requirePermission("staff.manage"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return removeMember(context.rt, context.tenantCtx, input);
        }),
      invitations: os.admin.memberships.invitations
        .use(requireAdmin)
        .use(requirePermission("staff.manage"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listInvitations(context.rt, context.tenantCtx);
        }),
      revokeInvitation: os.admin.memberships.revokeInvitation
        .use(requireAdmin)
        .use(requirePermission("staff.manage"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return revokeInvitation(context.rt, context.tenantCtx, input);
        }),
      // Public: the invite link carries the store id and a one-time token. Rate limited per IP.
      acceptInvite: os.admin.memberships.acceptInvite.handler(async ({ context, input }) => {
        const ip = clientIp(context.headers ?? new Headers());
        const limit = await checkRateLimit(context.rt._db.db, { key: `invite:accept:ip:${ip}`, limit: 10, windowSeconds: 900 });
        if (!limit.allowed) {
          throw new ORPCError("TOO_MANY_REQUESTS", { message: "Too many attempts. Try again later.", data: { retryAfter: limit.retryAfter } });
        }
        try {
          return await acceptInvitation(context.rt, input);
        } catch (err) {
          throw mapAuthError(err);
        }
      }),
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
    settingsOverview: {
      get: os.admin.settingsOverview.get
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getSettingsOverview(context.rt, context.tenantCtx);
        }),
    },
    settingsActivity: {
      list: os.admin.settingsActivity.list
        .use(requireAdmin)
        .use(requirePermission("audit.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listSettingsActivity(context.rt, context.tenantCtx, input);
        }),
    },
    orderSettings: {
      get: os.admin.orderSettings.get
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getOrderSettings(context.rt, context.tenantCtx);
        }),
      update: os.admin.orderSettings.update
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return updateOrderSettings(context.rt, context.tenantCtx, input);
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
      attachMedia: os.admin.products.attachMedia
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return attachProductMedia(context.rt, context.tenantCtx, { productId: input.id, mediaId: input.mediaId, alt: input.alt }).catch((e) => {
            throw mapAuthError(e);
          });
        }),
      detachMedia: os.admin.products.detachMedia
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return detachProductMedia(context.rt, context.tenantCtx, { productId: input.id, productMediaId: input.productMediaId }).catch((e) => {
            throw mapAuthError(e);
          });
        }),
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
      stats: os.admin.categories.stats
        .use(requireAdmin)
        .use(requirePermission("products.read"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getCategoryStats(context.rt, context.tenantCtx);
        }),
      get: os.admin.categories.get
        .use(requireAdmin)
        .use(requirePermission("products.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getCategory(context.rt, context.tenantCtx, input);
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
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listCollections(context.rt, context.tenantCtx, input);
        }),
      stats: os.admin.collections.stats
        .use(requireAdmin)
        .use(requirePermission("products.read"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getCollectionStats(context.rt, context.tenantCtx);
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
      stats: os.admin.brands.stats
        .use(requireAdmin)
        .use(requirePermission("products.read"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getBrandStats(context.rt, context.tenantCtx);
        }),
      get: os.admin.brands.get
        .use(requireAdmin)
        .use(requirePermission("products.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getBrand(context.rt, context.tenantCtx, input);
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

    // Catalog: Locations
    locations: {
      list: os.admin.locations.list
        .use(requireAdmin)
        .use(requirePermission("products.read"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listLocations(context.rt, context.tenantCtx);
        }),
      stats: os.admin.locations.stats
        .use(requireAdmin)
        .use(requirePermission("products.read"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getLocationStats(context.rt, context.tenantCtx);
        }),
      get: os.admin.locations.get
        .use(requireAdmin)
        .use(requirePermission("products.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getLocation(context.rt, context.tenantCtx, input);
        }),
      create: os.admin.locations.create
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return createLocation(context.rt, context.tenantCtx, input);
        }),
      update: os.admin.locations.update
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return updateLocation(context.rt, context.tenantCtx, input);
        }),
      delete: os.admin.locations.delete
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return deleteLocation(context.rt, context.tenantCtx, input);
        }),
    },

    // Reviews (Phase E)
    reviews: {
      list: os.admin.reviews.list
        .use(requireAdmin)
        .use(requirePermission("products.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listAdminReviews(context.rt, context.tenantCtx, input);
        }),
      stats: os.admin.reviews.stats
        .use(requireAdmin)
        .use(requirePermission("products.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getAdminReviewStats(context.rt, context.tenantCtx, input);
        }),
      get: os.admin.reviews.get
        .use(requireAdmin)
        .use(requirePermission("products.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getAdminReviewDetail(context.rt, context.tenantCtx, input.id);
        }),
      publish: os.admin.reviews.publish
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return publishAdminReview(context.rt, context.tenantCtx, input.id);
        }),
      hold: os.admin.reviews.hold
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return holdAdminReview(context.rt, context.tenantCtx, input.id);
        }),
      delete: os.admin.reviews.delete
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return deleteAdminReview(context.rt, context.tenantCtx, input.id);
        }),
      reply: os.admin.reviews.reply
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return replyAdminReview(context.rt, context.tenantCtx, input);
        }),
      bulkPublish: os.admin.reviews.bulkPublish
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return bulkPublishAdminReviews(context.rt, context.tenantCtx, input.ids);
        }),
      bulkHold: os.admin.reviews.bulkHold
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return bulkHoldAdminReviews(context.rt, context.tenantCtx, input.ids);
        }),
      bulkDelete: os.admin.reviews.bulkDelete
        .use(requireAdmin)
        .use(requirePermission("products.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return bulkDeleteAdminReviews(context.rt, context.tenantCtx, input.ids);
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
          return Promise.resolve(requestMediaUpload(context.rt, context.tenantCtx, input)).catch((e) => {
            throw mapAuthError(e);
          });
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
      library: os.admin.themes.library
        .use(requireAdmin)
        .use(requirePermission("content.write"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listThemeLibrary(context.rt, context.tenantCtx);
        }),
      preview: os.admin.themes.preview
        .use(requireAdmin)
        .use(requirePermission("content.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return previewThemeTemplate(context.rt, context.tenantCtx, input);
        }),
      activate: os.admin.themes.activate
        .use(requireAdmin)
        .use(requirePermission("theme.publish"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return activateTheme(context.rt, context.tenantCtx, input);
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
      versions: os.admin.pages.versions
        .use(requireAdmin)
        .use(requirePermission("content.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listPageVersions(context.rt, context.tenantCtx, input);
        }),
      blockData: os.admin.pages.blockData
        .use(requireAdmin)
        .use(requirePermission("content.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return previewPageRenderData(context.rt, context.tenantCtx, input);
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
      stats: os.admin.orders.stats
        .use(requireAdmin)
        .use(requirePermission("orders.read"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getAdminOrderStats(context.rt, context.tenantCtx);
        }),
      get: os.admin.orders.get
        .use(requireAdmin)
        .use(requirePermission("orders.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getAdminOrderDetail(context.rt, context.tenantCtx, input);
        }),
      estimateDraft: os.admin.orders.estimateDraft
        .use(requireAdmin)
        .use(requirePermission("orders.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return estimateAdminDraftOrder(context.rt, context.tenantCtx, input);
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
      confirm: os.admin.orders.confirm
        .use(requireAdmin)
        .use(requirePermission("orders.write"))
        .handler(async ({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          try {
            return await confirmAdminOrder(context.rt, context.tenantCtx, input);
          } catch (err) {
            throw mapAuthError(err);
          }
        }),
      advance: os.admin.orders.advance
        .use(requireAdmin)
        .use(requirePermission("orders.write"))
        .handler(async ({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          try {
            return await advanceAdminOrder(context.rt, context.tenantCtx, input);
          } catch (err) {
            throw mapAuthError(err);
          }
        }),
    },

    preorders: {
      list: os.admin.preorders.list
        .use(requireAdmin)
        .use(requirePermission("orders.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listPreorders(context.rt, context.tenantCtx, input);
        }),
      stats: os.admin.preorders.stats
        .use(requireAdmin)
        .use(requirePermission("orders.read"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getPreorderStats(context.rt, context.tenantCtx);
        }),
      changeShipDate: os.admin.preorders.changeShipDate
        .use(requireAdmin)
        .use(requirePermission("orders.write"))
        .handler(async ({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          try {
            return await changePreorderShipDate(context.rt, context.tenantCtx, input);
          } catch (err) {
            throw mapAuthError(err);
          }
        }),
      releaseNow: os.admin.preorders.releaseNow
        .use(requireAdmin)
        .use(requirePermission("orders.write"))
        .handler(async ({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          try {
            return await releasePreorderNow(context.rt, context.tenantCtx, input);
          } catch (err) {
            throw mapAuthError(err);
          }
        }),
    },

    returns: {
      stats: os.admin.returns.stats
        .use(requireAdmin)
        .use(requirePermission("orders.read"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getAdminReturnStats(context.rt, context.tenantCtx);
        }),
      list: os.admin.returns.list
        .use(requireAdmin)
        .use(requirePermission("orders.read"))
        .handler(async ({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return await listAdminReturns(context.rt, context.tenantCtx, input ?? {});
        }),
      get: os.admin.returns.get
        .use(requireAdmin)
        .use(requirePermission("orders.read"))
        .handler(async ({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return await getAdminReturnDetail(context.rt, context.tenantCtx, input);
        }),
      act: os.admin.returns.act
        .use(requireAdmin)
        .use(requirePermission("orders.write"))
        .handler(async ({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          try {
            return await actOnReturn(context.rt, context.tenantCtx, input);
          } catch (err) {
            throw mapAuthError(err);
          }
        }),
    },

    returnSettings: {
      get: os.admin.returnSettings.get
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getReturnSettings(context.rt, context.tenantCtx);
        }),
      update: os.admin.returnSettings.update
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return updateReturnSettings(context.rt, context.tenantCtx, input);
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
      stats: os.admin.customers.stats
        .use(requireAdmin)
        .use(requirePermission("customers.read"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getAdminCustomerStats(context.rt, context.tenantCtx);
        }),
      tags: os.admin.customers.tags
        .use(requireAdmin)
        .use(requirePermission("customers.read"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listAdminCustomerTags(context.rt, context.tenantCtx);
        }),
      get: os.admin.customers.get
        .use(requireAdmin)
        .use(requirePermission("customers.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getAdminCustomerDetail(context.rt, context.tenantCtx, input);
        }),
      create: os.admin.customers.create
        .use(requireAdmin)
        .use(requirePermission("customers.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return createAdminCustomer(context.rt, context.tenantCtx, input);
        }),
      update: os.admin.customers.update
        .use(requireAdmin)
        .use(requirePermission("customers.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return updateAdminCustomer(context.rt, context.tenantCtx, input);
        }),
      orders: os.admin.customers.orders
        .use(requireAdmin)
        .use(requirePermission("customers.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listAdminCustomerOrders(context.rt, context.tenantCtx, {
            customerId: input.id,
            status: input.status,
            limit: input.limit,
            offset: input.offset,
          });
        }),
      activity: os.admin.customers.activity
        .use(requireAdmin)
        .use(requirePermission("customers.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getAdminCustomerActivity(context.rt, context.tenantCtx, { customerId: input.id, limit: input.limit });
        }),
      consentSet: os.admin.customers.consentSet
        .use(requireAdmin)
        .use(requirePermission("customers.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return setAdminCustomerConsent(context.rt, context.tenantCtx, input);
        }),
      addresses: {
        add: os.admin.customers.addresses.add
          .use(requireAdmin)
          .use(requirePermission("customers.write"))
          .handler(({ context, input }) => {
            if (!context.tenantCtx) throw new Error("Missing tenant context");
            return addAdminCustomerAddress(context.rt, context.tenantCtx, { customerId: input.id, address: input.address });
          }),
        update: os.admin.customers.addresses.update
          .use(requireAdmin)
          .use(requirePermission("customers.write"))
          .handler(({ context, input }) => {
            if (!context.tenantCtx) throw new Error("Missing tenant context");
            return updateAdminCustomerAddress(context.rt, context.tenantCtx, { customerId: input.id, addressId: input.addressId, address: input.address });
          }),
        delete: os.admin.customers.addresses.delete
          .use(requireAdmin)
          .use(requirePermission("customers.write"))
          .handler(({ context, input }) => {
            if (!context.tenantCtx) throw new Error("Missing tenant context");
            return deleteAdminCustomerAddress(context.rt, context.tenantCtx, { customerId: input.id, addressId: input.addressId });
          }),
      },
      notes: {
        list: os.admin.customers.notes.list
          .use(requireAdmin)
          .use(requirePermission("customers.read"))
          .handler(({ context, input }) => {
            if (!context.tenantCtx) throw new Error("Missing tenant context");
            return listCustomerNotes(context.rt, context.tenantCtx, { customerId: input.id });
          }),
        add: os.admin.customers.notes.add
          .use(requireAdmin)
          .use(requirePermission("customers.write"))
          .handler(({ context, input }) => {
            if (!context.tenantCtx) throw new Error("Missing tenant context");
            return addCustomerNote(context.rt, context.tenantCtx, { customerId: input.id, body: input.body });
          }),
        delete: os.admin.customers.notes.delete
          .use(requireAdmin)
          .use(requirePermission("customers.write"))
          .handler(({ context, input }) => {
            if (!context.tenantCtx) throw new Error("Missing tenant context");
            return deleteCustomerNote(context.rt, context.tenantCtx, { id: input.noteId });
          }),
      },
      importPreview: os.admin.customers.importPreview
        .use(requireAdmin)
        .use(requirePermission("customers.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return previewCustomerImport(context.rt, context.tenantCtx, input);
        }),
      importCommit: os.admin.customers.importCommit
        .use(requireAdmin)
        .use(requirePermission("customers.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return commitCustomerImport(context.rt, context.tenantCtx, input);
        }),
      delete: os.admin.customers.delete
        .use(requireAdmin)
        .use(requirePermission("customers.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return deleteAdminCustomer(context.rt, context.tenantCtx, input);
        }),
      setStatus: os.admin.customers.setStatus
        .use(requireAdmin)
        .use(requirePermission("customers.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return setAdminCustomerStatus(context.rt, context.tenantCtx, input);
        }),
      setTags: os.admin.customers.setTags
        .use(requireAdmin)
        .use(requirePermission("customers.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return setAdminCustomerTags(context.rt, context.tenantCtx, input);
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
    shipping: {
      get: os.admin.shipping.get
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getAdminShippingSettings(context.rt._db.db, context.tenantCtx.tenantId);
        }),
      update: os.admin.shipping.update
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return updateAdminShippingSettings(context.rt._db.db, context.tenantCtx.tenantId, input);
        }),
    },
    storefront: {
      getStatus: os.admin.storefront.getStatus
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getStoreStatus(context.rt, context.tenantCtx).catch((e) => {
            throw mapAuthError(e);
          });
        }),
      updateStatus: os.admin.storefront.updateStatus
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(async ({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          const { launchAt, ...rest } = input;
          try {
            await updateStoreStatus(context.rt, context.tenantCtx, {
              ...rest,
              ...(launchAt !== undefined ? { launchAt: launchAt ? new Date(launchAt) : null } : {}),
            });
          } catch (e) {
            throw mapAuthError(e);
          }
          return getStoreStatus(context.rt, context.tenantCtx);
        }),
    },
    onboarding: {
      get: os.admin.onboarding.get
        .use(requireAdmin)
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getOnboardingProgress(context.rt, context.tenantCtx);
        }),
      dismiss: os.admin.onboarding.dismiss
        .use(requireAdmin)
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return dismissOnboardingProgress(context.rt, context.tenantCtx);
        }),
    },
    billing: {
      getSubscription: os.admin.billing.getSubscription
        .use(requireAdmin)
        .handler(async ({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          const data = await getTenantSubscription(context.rt, context.tenantCtx.tenantId);
          return {
            subscription: data.subscription
              ? {
                  id: data.subscription.id,
                  status: data.subscription.status,
                  interval: data.subscription.interval,
                  currentPeriodStart: data.subscription.currentPeriodStart?.toISOString() ?? null,
                  currentPeriodEnd: data.subscription.currentPeriodEnd?.toISOString() ?? null,
                  provider: data.subscription.provider,
                }
              : null,
            plan: data.plan
              ? {
                  id: data.plan.id,
                  code: data.plan.code,
                  name: data.plan.name,
                  priceMonthlyPaise: data.plan.priceMonthlyPaise,
                  priceYearlyPaise: data.plan.priceYearlyPaise,
                  currency: data.plan.currency,
                }
              : null,
            invoices: data.invoices.map((inv) => ({
              id: inv.id,
              number: inv.number,
              amountPaise: inv.amountPaise,
              taxPaise: inv.taxPaise,
              status: inv.status,
              issuedAt: inv.issuedAt.toISOString(),
              paidAt: inv.paidAt?.toISOString() ?? null,
            })),
            isTrial: data.isTrial,
            daysLeftInTrial: data.daysLeftInTrial,
          };
        }),
      changePlan: os.admin.billing.changePlan
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(async ({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          const session = context.session;
          const userEmail = session?.user?.email ?? "merchant@example.com";
          const res = await changeTenantPlan(context.rt, {
            tenantId: context.tenantCtx.tenantId,
            planCode: input.planCode,
            interval: input.interval,
            customerEmail: userEmail,
          });
          return {
            providerSubscriptionId: res.providerSubscriptionId,
            shortUrl: res.shortUrl ?? undefined,
            status: res.status,
          };
        }),
    },
    domains: {
      list: os.admin.domains.list
        .use(requireAdmin)
        .handler(async ({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          const rows = await listTenantDomains(context.rt, context.tenantCtx.tenantId);
          return rows.map((r) => ({
            id: r.id,
            hostname: r.hostname,
            type: r.type,
            isPrimary: r.isPrimary,
            status: r.status,
            sslStatus: r.sslStatus,
            prevalidateTxt: r.prevalidateTxt,
            verification: r.verification ?? null,
            createdAt: r.createdAt.toISOString(),
          }));
        }),
      add: os.admin.domains.add
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(async ({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          const created = await addCustomDomain(context.rt, context.tenantCtx.tenantId, {
            hostname: input.hostname,
            ...(input.prevalidateTxt !== undefined ? { prevalidateTxt: input.prevalidateTxt } : {}),
          });
          return {
            id: created.id,
            hostname: created.hostname,
            type: created.type,
            isPrimary: created.isPrimary,
            status: created.status,
            sslStatus: created.sslStatus,
            prevalidateTxt: created.prevalidateTxt,
            verification: created.verification ?? null,
            createdAt: created.createdAt.toISOString(),
          };
        }),
      verify: os.admin.domains.verify
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(async ({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          const updated = await verifyCustomDomain(context.rt, context.tenantCtx.tenantId, input.id);
          return {
            id: updated.id,
            hostname: updated.hostname,
            status: updated.status,
            sslStatus: updated.sslStatus,
          };
        }),
      setPrimary: os.admin.domains.setPrimary
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(async ({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return setPrimaryDomain(context.rt, context.tenantCtx.tenantId, input.id);
        }),
      remove: os.admin.domains.remove
        .use(requireAdmin)
        .use(requirePermission("settings.write"))
        .handler(async ({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return removeCustomDomain(context.rt, context.tenantCtx.tenantId, input.id);
        }),
    },
    quotes: {
      stats: os.admin.quotes.stats
        .use(requireAdmin)
        .use(requirePermission("orders.read"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getAdminQuoteStats(context.rt, context.tenantCtx);
        }),
      list: os.admin.quotes.list
        .use(requireAdmin)
        .use(requirePermission("orders.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listAdminQuotes(context.rt, context.tenantCtx, input);
        }),
      get: os.admin.quotes.get
        .use(requireAdmin)
        .use(requirePermission("orders.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getAdminQuoteDetail(context.rt, context.tenantCtx, input);
        }),
      updateNote: os.admin.quotes.updateNote
        .use(requireAdmin)
        .use(requirePermission("orders.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return updateAdminQuoteNote(context.rt, context.tenantCtx, input);
        }),
      markLost: os.admin.quotes.markLost
        .use(requireAdmin)
        .use(requirePermission("orders.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return markAdminQuoteLost(context.rt, context.tenantCtx, input);
        }),
      reopen: os.admin.quotes.reopen
        .use(requireAdmin)
        .use(requirePermission("orders.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return reopenAdminQuote(context.rt, context.tenantCtx, input);
        }),
      delete: os.admin.quotes.delete
        .use(requireAdmin)
        .use(requirePermission("orders.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return deleteAdminQuote(context.rt, context.tenantCtx, input);
        }),
      linkOrder: os.admin.quotes.linkOrder
        .use(requireAdmin)
        .use(requirePermission("orders.write"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return linkOrderToQuote(context.rt, context.tenantCtx, input);
        }),
    },
    abandonedCheckouts: {
      stats: os.admin.abandonedCheckouts.stats
        .use(requireAdmin)
        .use(requirePermission("orders.read"))
        .handler(({ context }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getAdminAbandonedCheckoutStats(context.rt, context.tenantCtx);
        }),
      list: os.admin.abandonedCheckouts.list
        .use(requireAdmin)
        .use(requirePermission("orders.read"))
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return listAdminAbandonedCheckouts(context.rt, context.tenantCtx, input);
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
    quotes: {
      submit: os.storefront.quotes.submit
        .use(requireStorefront)
        .handler(async ({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          const ip = clientIp(context.headers ?? new Headers());
          return submitQuoteRequest(context.rt, context.tenantCtx, {
            ...input,
            ip,
          });
        }),
    },

    reviews: {
      list: os.storefront.reviews.list
        .use(requireStorefront)
        .handler(({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          return getStorefrontReviews(context.rt, context.tenantCtx.tenantId, input);
        }),
      submit: os.storefront.reviews.submit
        .use(requireStorefront)
        .handler(async ({ context, input }) => {
          if (!context.tenantCtx) throw new Error("Missing tenant context");
          const customerId = context.session?.type === "customer" ? context.session.user.id : undefined;
          const ip = clientIp(context.headers ?? new Headers());
          return submitProductReview(context.rt, context.tenantCtx.tenantId, { ...input, ip }, customerId);
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

/**
 * Credentialed cross-origin access for the admin SPA only. The allowed origins come from config
 * (BETTER_AUTH_URL / ADMIN_ORIGINS); anything else gets no CORS headers, so browsers block it.
 */
api.use(
  "*",
  cors({
    origin: (origin) => (allowedApiOrigins().includes(origin) ? origin : null),
    credentials: true,
    allowHeaders: ["content-type", "x-store-id", "x-request-id", "x-support-token"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["x-request-id", "retry-after"],
    maxAge: 600,
  }),
);

/** CSRF defence in depth: a state-changing request that carries a staff cookie must come from an allowed origin. */
api.use("*", async (c, next) => {
  if (
    isForbiddenStaffOrigin({
      method: c.req.method,
      path: c.req.path,
      cookie: c.req.header("cookie"),
      origin: c.req.header("origin"),
      allowedOrigins: allowedApiOrigins(),
    })
  ) {
    return c.json({ error: "Origin not allowed" }, 403);
  }
  await next();
});

/** Staff authentication (Better Auth): sign-in, sign-out, get-session. Public sign-up is disabled. */
api.all("/auth/*", async (c) => {
  const cfg = getStaffAuth();
  if (!cfg) {
    return c.json({ error: "Admin sign-in is not configured on this server (BETTER_AUTH_URL / BETTER_AUTH_SECRET)." }, 503);
  }
  const req = c.req.raw;
  const path = new URL(req.url).pathname;

  if (req.method === "POST" && path.endsWith("/request-password-reset")) {
    const db = server().rt._db.db;
    const ip = clientIp(req.headers);
    try {
      await checkPasswordResetRateLimit(db, { ip });
    } catch (err) {
      if (err instanceof RateLimitExceededError) {
        return c.json({ error: err.message }, 429, { "retry-after": String(err.retryAfter) });
      }
      throw err;
    }
  }

  if (req.method === "POST" && path.endsWith("/reset-password")) {
    const db = server().rt._db.db;
    const ip = clientIp(req.headers);
    try {
      await checkResetPasswordConfirmRateLimit(db, { ip });
    } catch (err) {
      if (err instanceof RateLimitExceededError) {
        return c.json({ error: err.message }, 429, { "retry-after": String(err.retryAfter) });
      }
      throw err;
    }
  }

  if (req.method === "POST" && path.endsWith("/change-password")) {
    // Intercept change-password to send notification if successful
    const res = await cfg.auth.handler(req);
    if (res.status === 200) {
      const session = await resolveStaffSession(c.req.raw.headers);
      if (session?.user?.email) {
        const email = session.user.email;
        const rt = server().rt;
        const brand = { storeName: "Brand Sewa Admin", baseUrl: cfg.settings.adminOrigins[0] ?? cfg.settings.baseURL };
        const { html, text } = renderEmail("password_changed", brand, {}, "Your password was changed");
        queueMicrotask(async () => {
          try {
            await sendPlatformEmail(rt._db.db, {
              to: email,
              subject: "Your password was changed",
              html,
              text,
              fromName: "Brand Sewa Admin",
              template: "password_changed",
            });
          } catch (err) {
            server().log.error({ err, email }, "Failed to send staff password changed email");
          }
        });
      }
    }
    return res;
  }

  if (req.method === "POST" && path.endsWith("/sign-in/email")) {
    let email = "";
    try {
      const body = (await req.clone().json()) as { email?: unknown };
      email = typeof body.email === "string" ? body.email : "";
    } catch {
      /* malformed body: let Better Auth reject it */
    }
    const db = server().rt._db.db;
    const ip = clientIp(req.headers);
    const who = email || "unknown";
    const wait = await loginRetryAfter(db, ip, who);
    if (wait !== null) {
      return c.json({ error: `Too many failed sign-in attempts. Try again in ${Math.ceil(wait / 60)} minutes.` }, 429, {
        "retry-after": String(wait),
      });
    }
    const res = await cfg.auth.handler(req);
    if (res.status >= 400) await recordLoginFailure(db, ip, who);
    else await clearLoginFailures(db, who);
    return res;
  }
  return cfg.auth.handler(req);
});

/** SaaS Self-service Endpoints (PLAN §5.1, §7) */
// Any self-service route reached without DATABASE_URL_SAAS answers a clean 503 instead of a raw 500.
api.onError((err, c) => {
  if (err instanceof SaasNotConfiguredError) return c.json({ error: err.message }, 503);
  server().log.error({ err }, "api error");
  return c.text("Internal Server Error", 500);
});

api.get("/saas/subdomain/check", async (c) => {
  const slug = c.req.query("slug");
  if (!slug) return c.json({ available: false, reason: "Slug parameter is required" }, 400);
  const db = saasDb(server().rt);
  const result = await checkSubdomainAvailability(db, slug);
  return c.json(result);
});

api.post("/saas/subdomain/reserve", async (c) => {
  const ip = clientIp(c.req.raw.headers);
  const db = saasDb(server().rt);

  const rateCheck = await checkReserveSubdomainRateLimit(db, ip);
  if (!rateCheck.allowed) {
    return c.json(
      { success: false, reason: "Too many subdomain reservation requests. Please try again later." },
      429,
    );
  }

  const body = (await c.req.json().catch(() => ({}))) as { slug?: unknown; leadId?: unknown };
  const slug = typeof body.slug === "string" ? body.slug : "";
  const leadId = typeof body.leadId === "string" ? body.leadId : undefined;
  if (!slug) return c.json({ success: false, reason: "Slug is required" }, 400);
  const result = await reserveSubdomain(db, slug, leadId);
  return c.json(result, result.success ? 200 : 409);
});

api.post("/saas/lead", async (c) => {
  const ip = clientIp(c.req.raw.headers);
  const db = saasDb(server().rt);

  const rateCheck = await checkLeadCaptureRateLimit(db, ip);
  if (!rateCheck.allowed) {
    return c.json(
      { error: "Too many requests. Please try again later." },
      429,
    );
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await saveSignupLead(db, {
    ...body,
    ipHash: hashIpWithSalt(ip),
  });
  return c.json(result);
});

api.get("/saas/config", (c) => {
  // Public, non-secret runtime config for the signup page.
  return c.json({ turnstileSiteKey: process.env.TURNSTILE_SITE_KEY?.trim() || null });
});

api.get("/saas/plans", async (c) => {
  const db = saasDb(server().rt);
  const plans = await listPublicPlans(db);
  return c.json(plans);
});

api.get("/saas/templates", async (c) => {
  const db = saasDb(server().rt);
  const templates = await listPublicThemeTemplates(db);
  return c.json(templates);
});

api.post("/saas/signup", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Parameters<typeof completeSignup>[1];
  const rt = server().rt;
  const ip = clientIp(c.req.raw.headers);
  try {
    const result = await completeSignup(rt, {
      ...body,
      clientIp: ip,
    });
    return c.json(result, 201);
  } catch (err: unknown) {
    if (err instanceof SaasNotConfiguredError) return c.json({ error: err.message }, 503);
    const message = err instanceof Error ? err.message : "Failed to provision store";
    return c.json({ error: message }, 400);
  }
});

api.post("/saas/invite/accept", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { token?: string; password?: string; name?: string };
  if (!body.token || !body.password) {
    return c.json({ error: "Token and password are required" }, 400);
  }
  const rt = server().rt;
  try {
    const limit = await checkInviteAcceptRateLimit(saasDb(rt), clientIp(c.req.raw.headers), body.token);
    if (!limit.allowed) return c.json({ error: "Too many attempts. Please try again later." }, 429);
    const res = await acceptTenantOwnerInvite(rt, {
      token: body.token,
      password: body.password,
      name: body.name,
    });
    return c.json(res);
  } catch (err: unknown) {
    if (err instanceof SaasNotConfiguredError) return c.json({ error: err.message }, 503);
    const message = err instanceof Error ? err.message : "Failed to accept store invitation";
    return c.json({ error: message }, 400);
  }
});

/** Liveness + DB readiness, used by Docker/Coolify health checks. */
api.get("/health", async (c) => {
  const h = await checkHealth(server().rt);
  return c.json(h, h.db.ok ? 200 : 503);
});

api.all("/rpc/*", async (c, next) => {
  const session = await resolveStaffSession(c.req.raw.headers);
  const { matched, response } = await rpc.handle(c.req.raw, {
    prefix: "/api/rpc",
    context: { rt: server().rt, log: c.get("log"), headers: c.req.raw.headers, requestInfo: { method: c.req.method, path: c.req.path }, session },
  });
  if (matched) return c.newResponse(response.body, response);
  await next();
});

api.all("/*", async (c, next) => {
  const session = await resolveStaffSession(c.req.raw.headers);
  const { matched, response } = await openapi.handle(c.req.raw, {
    prefix: "/api",
    context: { rt: server().rt, log: c.get("log"), headers: c.req.raw.headers, requestInfo: { method: c.req.method, path: c.req.path }, session },
  });
  if (matched) return c.newResponse(response.body, response);
  await next();
});
