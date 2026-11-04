import { oc } from "@orpc/contract";
import { z } from "zod";

/** Apps framework and State Pricing (ADR-043, ADR-044). Store admin contract plus the Super Admin marketplace contract. */
const Uuid = z.string().uuid();
const AppKey = z.string().min(1).max(60);
const StateCode = z.string().regex(/^[A-Z]{2}$/);

export const StoreAppRecord = z.object({
  key: AppKey,
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  category: z.string(),
  installed: z.boolean(),
  status: z.enum(["installed", "disabled"]).nullable(),
  suspended: z.boolean(),
  settings: z.record(z.string(), z.unknown()),
});
export type StoreAppRecord = z.infer<typeof StoreAppRecord>;

const KeyInput = z.object({ key: AppKey });

export const StatePriceEntry = z.object({ price: z.number().int(), compareAtPrice: z.number().int().nullable() });

export const ProductStatePricing = z.object({
  productId: Uuid,
  productTitle: z.string(),
  variants: z.array(
    z.object({
      variantId: Uuid,
      title: z.string(),
      sku: z.string().nullable(),
      basePrice: z.number().int(),
      prices: z.record(z.string(), StatePriceEntry),
    }),
  ),
});

export type ProductStatePricing = z.infer<typeof ProductStatePricing>;

export const appsContract = {
  list: oc.route({ method: "GET", path: "/admin/apps" }).output(z.array(StoreAppRecord)),
  install: oc.route({ method: "POST", path: "/admin/apps/{key}/install" }).input(KeyInput).output(StoreAppRecord),
  setStatus: oc
    .route({ method: "PUT", path: "/admin/apps/{key}/status" })
    .input(z.object({ key: AppKey, status: z.enum(["installed", "disabled"]) }))
    .output(StoreAppRecord),
  uninstall: oc.route({ method: "DELETE", path: "/admin/apps/{key}" }).input(KeyInput).output(z.object({ removed: z.literal(true) })),
  updateSettings: oc
    .route({ method: "PUT", path: "/admin/apps/{key}/settings" })
    .input(z.object({ key: AppKey, settings: z.record(z.string(), z.unknown()) }))
    .output(StoreAppRecord),
  states: oc.route({ method: "GET", path: "/admin/apps/state-pricing/states" }).output(z.array(z.object({ code: StateCode, name: z.string() }))),
  getProductPricing: oc
    .route({ method: "GET", path: "/admin/apps/state-pricing/products/{productId}" })
    .input(z.object({ productId: Uuid }))
    .output(ProductStatePricing),
  setVariantPricing: oc
    .route({ method: "PUT", path: "/admin/apps/state-pricing/variants/{variantId}" })
    .input(
      z.object({
        variantId: Uuid,
        prices: z
          .array(z.object({ state: StateCode, price: z.number().int().positive().nullable(), compareAtPrice: z.number().int().positive().nullable().optional() }))
          .min(1)
          .max(40),
      }),
    )
    .output(z.object({ saved: z.number().int(), removed: z.number().int() })),
};

export const PlatformAppRecord = z.object({
  key: AppKey,
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  category: z.string(),
  visibility: z.enum(["public", "private"]),
  allowedTenantIds: z.array(Uuid),
  enabled: z.boolean(),
  installCount: z.number().int(),
  installs: z.array(z.object({ tenantId: Uuid, tenantSlug: z.string(), status: z.string(), suspended: z.boolean() })),
});

export type PlatformAppRecord = z.infer<typeof PlatformAppRecord>;

export const platformMarketplaceContract = {
  list: oc.route({ method: "GET", path: "/platform/marketplace/apps" }).output(z.array(PlatformAppRecord)),
  update: oc
    .route({ method: "PATCH", path: "/platform/marketplace/apps/{key}" })
    .input(z.object({ key: AppKey, visibility: z.enum(["public", "private"]).optional(), allowedTenantIds: z.array(Uuid).max(500).optional(), enabled: z.boolean().optional() }))
    .output(PlatformAppRecord),
  pincodeStatus: oc.route({ method: "GET", path: "/platform/marketplace/pincodes" }).output(z.object({ count: z.number().int() })),
  importPincodes: oc
    .route({ method: "POST", path: "/platform/marketplace/pincodes" })
    .input(z.object({ data: z.string().min(2).max(6_000_000) }))
    .output(z.object({ imported: z.number().int(), skipped: z.number().int(), total: z.number().int(), skippedSample: z.array(z.string()) })),
  setSuspended: oc
    .route({ method: "PUT", path: "/platform/marketplace/apps/{key}/tenants/{tenantId}" })
    .input(z.object({ key: AppKey, tenantId: Uuid, suspended: z.boolean() }))
    .output(z.object({ ok: z.literal(true) })),
};
